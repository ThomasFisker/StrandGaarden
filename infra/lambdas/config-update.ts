import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { CONFIG_PK, CONFIG_SK, DEFAULT_CONFIG, getConfig, type AppConfig } from './config-shared';
import { isAdmin, json } from './persons-shared';

const region = process.env.AWS_REGION ?? 'eu-west-1';
const tableName = process.env.TABLE_NAME!;
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region }));

const STAGE_VALUES = new Set([1, 2, 3]);
const SLOTS_MIN = 1;
const SLOTS_MAX = 50;
const CHARS_MIN = 100;
const CHARS_MAX = 10_000;
const GDPR_MIN = 10;
const GDPR_MAX = 50_000;

interface UpdateBody {
  stage?: unknown;
  maxBookSlotsPerHouse?: unknown;
  maxHouseTextChars?: unknown;
  gdprText?: unknown;
  bumpGdprVersion?: unknown;
}

export const handler = async (event: APIGatewayProxyEventV2WithJWTAuthorizer) => {
  if (!isAdmin(event)) return json(403, { error: 'Admin only' });

  let body: UpdateBody;
  try {
    body = JSON.parse(event.body ?? '{}') as UpdateBody;
  } catch {
    return json(400, { error: 'Request body must be valid JSON' });
  }

  const current = await getConfig(ddb, tableName);
  const next: AppConfig = { ...current };
  const errors: string[] = [];

  if (body.stage !== undefined) {
    if (!STAGE_VALUES.has(body.stage as number)) errors.push('stage must be 1, 2 or 3');
    else next.stage = body.stage as 1 | 2 | 3;
  }
  if (body.maxBookSlotsPerHouse !== undefined) {
    const n = Number(body.maxBookSlotsPerHouse);
    if (!Number.isInteger(n) || n < SLOTS_MIN || n > SLOTS_MAX) {
      errors.push(`maxBookSlotsPerHouse must be an integer between ${SLOTS_MIN} and ${SLOTS_MAX}`);
    } else next.maxBookSlotsPerHouse = n;
  }
  if (body.maxHouseTextChars !== undefined) {
    const n = Number(body.maxHouseTextChars);
    if (!Number.isInteger(n) || n < CHARS_MIN || n > CHARS_MAX) {
      errors.push(`maxHouseTextChars must be an integer between ${CHARS_MIN} and ${CHARS_MAX}`);
    } else next.maxHouseTextChars = n;
  }
  if (body.gdprText !== undefined) {
    const t = typeof body.gdprText === 'string' ? body.gdprText : '';
    if (t.length < GDPR_MIN || t.length > GDPR_MAX) {
      errors.push(`gdprText must be ${GDPR_MIN}–${GDPR_MAX} chars`);
    } else next.gdprText = t;
  }
  if (errors.length) return json(400, { error: 'Validation failed', details: errors });

  const bump = body.bumpGdprVersion === true;
  if (bump) next.gdprVersion = new Date().toISOString();

  const claims = event.requestContext.authorizer?.jwt?.claims ?? {};
  const by = typeof claims.sub === 'string' ? claims.sub : '';
  const byEmail = typeof claims.email === 'string' ? claims.email : '';
  const at = new Date().toISOString();

  await ddb.send(
    new PutCommand({
      TableName: tableName,
      Item: {
        PK: CONFIG_PK,
        SK: CONFIG_SK,
        entity: 'Config',
        ...next,
        lastEditedAt: at,
        lastEditedBy: by,
        lastEditedByEmail: byEmail,
      },
    }),
  );

  return json(200, { ...next, defaults: DEFAULT_CONFIG });
};
