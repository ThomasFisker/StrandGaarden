import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { canViewDocs } from './permissions';
import { DOCCATEGORYLIST_PK, DOC_CATEGORY_SK_PREFIX } from './doc-categories-shared';

const region = process.env.AWS_REGION ?? 'eu-west-1';
const tableName = process.env.TABLE_NAME!;
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region }));

const json = (statusCode: number, body: unknown) => ({
  statusCode,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

export const handler = async (event: APIGatewayProxyEventV2WithJWTAuthorizer) => {
  if (!event.requestContext.authorizer?.jwt?.claims) return json(401, { error: 'Unauthorized' });
  if (!canViewDocs(event)) return json(403, { error: 'Forbidden' });

  const items: Record<string, unknown>[] = [];
  let ExclusiveStartKey: Record<string, unknown> | undefined;
  do {
    const r = await ddb.send(
      new QueryCommand({
        TableName: tableName,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
        ExpressionAttributeValues: { ':pk': DOCCATEGORYLIST_PK, ':sk': DOC_CATEGORY_SK_PREFIX },
        ExclusiveStartKey,
      }),
    );
    for (const it of r.Items ?? []) items.push(it);
    ExclusiveStartKey = r.LastEvaluatedKey;
  } while (ExclusiveStartKey);

  const rows = items
    .map((it) => ({
      key: String(it.key ?? ''),
      displayName: String(it.displayName ?? ''),
      displayOrder: typeof it.displayOrder === 'number' ? it.displayOrder : 0,
      createdAt: typeof it.createdAt === 'string' ? it.createdAt : null,
      createdByEmail: typeof it.createdByEmail === 'string' ? it.createdByEmail : null,
    }))
    .sort((a, b) => {
      if (a.displayOrder !== b.displayOrder) return a.displayOrder - b.displayOrder;
      return a.displayName.localeCompare(b.displayName, 'da');
    });

  return json(200, { items: rows });
};
