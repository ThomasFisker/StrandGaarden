import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { ACTIVITY_SK_PREFIX, ACTIVITYLIST_PK, type ActivityRow } from './activities-shared';
import { json } from './persons-shared';

const region = process.env.AWS_REGION ?? 'eu-west-1';
const tableName = process.env.TABLE_NAME!;
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region }));

export const handler = async (event: APIGatewayProxyEventV2WithJWTAuthorizer) => {
  // Any authed user can read the activity list (members need it to pick a
  // keyword at upload time in Stage 1).
  if (!event.requestContext.authorizer?.jwt?.claims) return json(401, { error: 'Unauthorized' });

  const items: Record<string, unknown>[] = [];
  let ExclusiveStartKey: Record<string, unknown> | undefined;
  do {
    const r = await ddb.send(
      new QueryCommand({
        TableName: tableName,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
        ExpressionAttributeValues: { ':pk': ACTIVITYLIST_PK, ':sk': ACTIVITY_SK_PREFIX },
        ExclusiveStartKey,
      }),
    );
    for (const it of r.Items ?? []) items.push(it);
    ExclusiveStartKey = r.LastEvaluatedKey;
  } while (ExclusiveStartKey);

  const rows: ActivityRow[] = items
    .map((it) => ({
      key: String(it.key ?? ''),
      displayName: String(it.displayName ?? ''),
      displayOrder: typeof it.displayOrder === 'number' ? it.displayOrder : 0,
      createdAt: typeof it.createdAt === 'string' ? it.createdAt : null,
      createdBy: typeof it.createdBy === 'string' ? it.createdBy : null,
    }))
    .filter((r) => r.key.length > 0)
    .sort((a, b) => {
      if (a.displayOrder !== b.displayOrder) return a.displayOrder - b.displayOrder;
      return a.displayName.localeCompare(b.displayName, 'da');
    });

  return json(200, { items: rows });
};
