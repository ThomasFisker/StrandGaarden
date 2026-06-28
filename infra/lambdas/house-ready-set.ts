import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { FREEZE_ERROR_MESSAGE, getConfig, isFrozenForCaller } from './config-shared';
import {
  houseTextPk,
  HOUSETEXT_SK,
  isValidHouse,
  json,
  parseGroups,
  USER_SK,
  userPk,
} from './users-shared';

const region = process.env.AWS_REGION ?? 'eu-west-1';
const tableName = process.env.TABLE_NAME!;
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region }));

/** PATCH /houses/{house}/book-ready — mark a house's contribution as
 * finished (or re-open it) so the redaktionen can start building that
 * chapter early.
 *
 * Self-declaration toggle: body `{ ready: boolean }`. The flag lives on
 * the per-house `HOUSETEXT#<n>/META` row (alongside the chapter text) so
 * the admin overview, which already scans those rows, gets it for free.
 *
 * Admins can flip any house. A member can flip only the house they're
 * assigned to. Houses are shared (several members), so any co-owner can
 * set/unset it — we record who last changed it. Stage-2 freeze blocks
 * non-admins, consistent with the other member write endpoints. */
export const handler = async (event: APIGatewayProxyEventV2WithJWTAuthorizer) => {
  const claims = event.requestContext.authorizer?.jwt?.claims ?? {};
  const callerSub = typeof claims.sub === 'string' ? claims.sub : '';
  if (!callerSub) return json(401, { error: 'Unauthorized' });

  const groups = parseGroups(claims['cognito:groups']);
  const isAdminCaller = groups.includes('admin');

  const houseRaw = event.pathParameters?.house;
  const house = houseRaw === undefined ? NaN : Number(houseRaw);
  if (!isValidHouse(house)) {
    return json(400, { error: 'house must be a valid Strandgaarden house number' });
  }

  let body: { ready?: unknown };
  try {
    body = JSON.parse(event.body ?? '{}');
  } catch {
    return json(400, { error: 'Request body must be valid JSON' });
  }
  if (typeof body.ready !== 'boolean') {
    return json(400, { error: 'ready must be a boolean' });
  }
  const ready = body.ready;

  const cfg = await getConfig(ddb, tableName);
  if (isFrozenForCaller(cfg, isAdminCaller)) {
    return json(423, { error: FREEZE_ERROR_MESSAGE });
  }

  // Authorize: admin OK; otherwise caller must be assigned to this house.
  if (!isAdminCaller) {
    const u = await ddb.send(
      new GetCommand({ TableName: tableName, Key: { PK: userPk(callerSub), SK: USER_SK } }),
    );
    const callerHouse =
      u.Item && typeof u.Item.houseNumber === 'number' ? (u.Item.houseNumber as number) : null;
    if (callerHouse !== house) {
      return json(403, { error: 'Du kan kun melde dit eget hus klar.' });
    }
  }

  const at = new Date().toISOString();
  const byLoginName =
    typeof claims.preferred_username === 'string' ? claims.preferred_username : '';

  await ddb.send(
    new UpdateCommand({
      TableName: tableName,
      Key: { PK: houseTextPk(house), SK: HOUSETEXT_SK },
      UpdateExpression:
        'SET entity = if_not_exists(entity, :ent), createdAt = if_not_exists(createdAt, :at), ' +
        'houseNumber = :hn, bookReady = :r, bookReadyAt = :at, ' +
        'bookReadyBy = :by, bookReadyByLoginName = :byLn',
      ExpressionAttributeValues: {
        ':ent': 'HouseText',
        ':at': at,
        ':hn': house,
        ':r': ready,
        ':by': callerSub,
        ':byLn': byLoginName,
      },
    }),
  );

  return json(200, {
    houseNumber: house,
    bookReady: ready,
    bookReadyAt: at,
    bookReadyByLoginName: byLoginName,
  });
};
