import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { getConfig } from './config-shared';
import {
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

/** GET /me — returns the caller's own profile row.
 *
 * Used by the Upload form to prefill the user's assigned house, and by the
 * GDPR consent gate to know whether the user has accepted the current
 * version. Any authed user can call this for their own row; the row may
 * be absent (returns null fields) for users whose admin never assigned a
 * house. The response also surfaces `gdprCurrentVersion` so the client
 * can render the consent gate without a second round trip. */
export const handler = async (event: APIGatewayProxyEventV2WithJWTAuthorizer) => {
  const claims = event.requestContext.authorizer?.jwt?.claims ?? {};
  const sub = typeof claims.sub === 'string' ? claims.sub : '';
  if (!sub) return json(401, { error: 'Unauthorized' });

  const [userRow, cfg] = await Promise.all([
    ddb.send(new GetCommand({ TableName: tableName, Key: { PK: userPk(sub), SK: USER_SK } })),
    getConfig(ddb, tableName),
  ]);
  const it = userRow.Item ?? {};

  const gdprAcceptedVersion =
    typeof it.gdprAcceptedVersion === 'string' ? it.gdprAcceptedVersion : null;
  const houseNumber = typeof it.houseNumber === 'number' ? it.houseNumber : null;

  // House text — fetched whenever the user has a house assigned. Cheap
  // (single Get on a known key); null if the row hasn't been written yet.
  let myHouseText: string | null = null;
  if (houseNumber !== null) {
    const ht = await ddb.send(
      new GetCommand({
        TableName: tableName,
        Key: { PK: houseTextPk(houseNumber), SK: HOUSETEXT_SK },
        ProjectionExpression: '#b',
        ExpressionAttributeNames: { '#b': 'body' },
      }),
    );
    if (ht.Item && typeof ht.Item.body === 'string') myHouseText = ht.Item.body;
  }

  // House slot usage — only relevant when the user has a house assigned
  // and the system might surface the per-house cap (Stage 1). Skipping
  // the scan in Stage 3 keeps /me cheap on every page load.
  let myHouseSlotsUsed: number | null = null;
  if (houseNumber !== null && cfg.stage === 1) {
    let count = 0;
    let ExclusiveStartKey: Record<string, unknown> | undefined;
    do {
      const r = await ddb.send(
        new ScanCommand({
          TableName: tableName,
          FilterExpression: 'entity = :p AND contains(houseNumbers, :h)',
          ExpressionAttributeValues: { ':p': 'Photo', ':h': houseNumber },
          ProjectionExpression: 'photoId',
          ExclusiveStartKey,
        }),
      );
      count += r.Items?.length ?? 0;
      ExclusiveStartKey = r.LastEvaluatedKey;
    } while (ExclusiveStartKey);
    myHouseSlotsUsed = count;
  }

  return json(200, {
    sub,
    email: typeof claims.email === 'string' ? claims.email : null,
    loginName: typeof claims.preferred_username === 'string' ? claims.preferred_username : null,
    groups: parseGroups(claims['cognito:groups']),
    houseNumber,
    gdprAcceptedAt: typeof it.gdprAcceptedAt === 'string' ? it.gdprAcceptedAt : null,
    gdprAcceptedVersion,
    gdprCurrentVersion: cfg.gdprVersion,
    gdprNeedsAcceptance: gdprAcceptedVersion !== cfg.gdprVersion,
    stage: cfg.stage,
    maxBookSlotsPerHouse: cfg.maxBookSlotsPerHouse,
    myHouseSlotsUsed,
    maxHouseTextChars: cfg.maxHouseTextChars,
    myHouseText,
    firstLoginAcked: it.firstLoginAcked === true,
  });
};
