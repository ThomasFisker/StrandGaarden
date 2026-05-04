import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { FREEZE_ERROR_MESSAGE, getConfig, isFrozenForCaller } from './config-shared';
import {
  HOUSE_MAX,
  HOUSE_MIN,
  houseTextPk,
  HOUSETEXT_SK,
  json,
  parseGroups,
  USER_SK,
  userPk,
} from './users-shared';

const region = process.env.AWS_REGION ?? 'eu-west-1';
const tableName = process.env.TABLE_NAME!;
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region }));

/** PATCH /house-texts/{house} — write the chapter-intro text for a house.
 *
 * Admins can edit any house. Members can edit only the house they're
 * assigned to in their USER row. Body length is capped by
 * config.maxHouseTextChars (configurable in /admin/fase). Empty body
 * clears the text. Stage-2 freeze blocks non-admins. */
export const handler = async (event: APIGatewayProxyEventV2WithJWTAuthorizer) => {
  const claims = event.requestContext.authorizer?.jwt?.claims ?? {};
  const callerSub = typeof claims.sub === 'string' ? claims.sub : '';
  if (!callerSub) return json(401, { error: 'Unauthorized' });

  const groups = parseGroups(claims['cognito:groups']);
  const isAdminCaller = groups.includes('admin');

  const houseRaw = event.pathParameters?.house;
  const house = houseRaw === undefined ? NaN : Number(houseRaw);
  if (!Number.isInteger(house) || house < HOUSE_MIN || house > HOUSE_MAX) {
    return json(400, { error: `house must be ${HOUSE_MIN}–${HOUSE_MAX}` });
  }

  let body: { body?: unknown };
  try {
    body = JSON.parse(event.body ?? '{}');
  } catch {
    return json(400, { error: 'Request body must be valid JSON' });
  }
  const text = typeof body.body === 'string' ? body.body : '';

  const cfg = await getConfig(ddb, tableName);
  if (isFrozenForCaller(cfg, isAdminCaller)) {
    return json(423, { error: FREEZE_ERROR_MESSAGE });
  }
  // The rich-text editor on /mine emits HTML (b/i/h2 + paragraphs). The
  // length cap is on visible characters, so strip tags and decode the
  // common entities before counting. Hard cap on raw length too so a
  // malicious client can't send a 1MB string with empty visible text.
  const visible = text
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
  if (visible.length > cfg.maxHouseTextChars) {
    return json(400, {
      error: `Teksten er for lang (maks ${cfg.maxHouseTextChars} tegn). Du har skrevet ${visible.length}.`,
    });
  }
  const HARD_HTML_LIMIT = cfg.maxHouseTextChars * 8;
  if (text.length > HARD_HTML_LIMIT) {
    return json(400, { error: 'Teksten er for stor.' });
  }

  // Authorize: admin OK; otherwise caller must be assigned to this house.
  if (!isAdminCaller) {
    const u = await ddb.send(
      new GetCommand({ TableName: tableName, Key: { PK: userPk(callerSub), SK: USER_SK } }),
    );
    const callerHouse =
      u.Item && typeof u.Item.houseNumber === 'number' ? (u.Item.houseNumber as number) : null;
    if (callerHouse !== house) {
      return json(403, { error: `Du kan kun redigere teksten for dit eget hus.` });
    }
  }

  const at = new Date().toISOString();
  const editorEmail = typeof claims.email === 'string' ? claims.email : '';
  const editorLoginName =
    typeof claims.preferred_username === 'string' ? claims.preferred_username : '';

  await ddb.send(
    new UpdateCommand({
      TableName: tableName,
      Key: { PK: houseTextPk(house), SK: HOUSETEXT_SK },
      UpdateExpression:
        'SET entity = if_not_exists(entity, :ent), createdAt = if_not_exists(createdAt, :at), ' +
        'houseNumber = :hn, body = :b, lastEditedAt = :at, lastEditedBy = :by, ' +
        'lastEditedByEmail = :byE, lastEditedByLoginName = :byLn',
      ExpressionAttributeValues: {
        ':ent': 'HouseText',
        ':at': at,
        ':hn': house,
        ':b': text,
        ':by': callerSub,
        ':byE': editorEmail,
        ':byLn': editorLoginName,
      },
    }),
  );

  return json(200, {
    houseNumber: house,
    body: text,
    lastEditedAt: at,
    lastEditedBy: callerSub,
    lastEditedByLoginName: editorLoginName,
  });
};
