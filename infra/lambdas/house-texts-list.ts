import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { HOUSE_MAX, HOUSE_MIN, HOUSETEXT_PK_PREFIX, json, parseGroups } from './users-shared';

const region = process.env.AWS_REGION ?? 'eu-west-1';
const tableName = process.env.TABLE_NAME!;
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region }));

/** GET /house-texts — admin only.
 *
 * Returns one entry per house in 1..HOUSE_MAX, with body=null and
 * audit fields=null where no text has been written yet. Sorted by
 * house number. */
export const handler = async (event: APIGatewayProxyEventV2WithJWTAuthorizer) => {
  const claims = event.requestContext.authorizer?.jwt?.claims ?? {};
  if (!parseGroups(claims['cognito:groups']).includes('admin')) {
    return json(403, { error: 'Admin only' });
  }

  const written = new Map<number, Record<string, unknown>>();
  let ExclusiveStartKey: Record<string, unknown> | undefined;
  do {
    const r = await ddb.send(
      new ScanCommand({
        TableName: tableName,
        FilterExpression: 'begins_with(PK, :pfx) AND SK = :sk',
        ExpressionAttributeValues: { ':pfx': HOUSETEXT_PK_PREFIX, ':sk': 'META' },
        ExclusiveStartKey,
      }),
    );
    for (const it of r.Items ?? []) {
      const n = typeof it.houseNumber === 'number' ? it.houseNumber : NaN;
      if (Number.isInteger(n) && n >= HOUSE_MIN && n <= HOUSE_MAX) written.set(n, it);
    }
    ExclusiveStartKey = r.LastEvaluatedKey;
  } while (ExclusiveStartKey);

  const items = [];
  for (let n = HOUSE_MIN; n <= HOUSE_MAX; n++) {
    const it = written.get(n);
    items.push({
      houseNumber: n,
      body: it && typeof it.body === 'string' ? it.body : null,
      lastEditedAt: it && typeof it.lastEditedAt === 'string' ? it.lastEditedAt : null,
      lastEditedBy: it && typeof it.lastEditedBy === 'string' ? it.lastEditedBy : null,
      lastEditedByLoginName:
        it && typeof it.lastEditedByLoginName === 'string' ? it.lastEditedByLoginName : null,
      lastEditedByEmail:
        it && typeof it.lastEditedByEmail === 'string' ? it.lastEditedByEmail : null,
    });
  }

  return json(200, { items });
};
