import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';
import { ConditionalCheckFailedException, DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, DeleteCommand } from '@aws-sdk/lib-dynamodb';
import { canManageSystemConfig } from './permissions';
import { DOCCATEGORYLIST_PK, DOC_CATEGORY_SK_PREFIX } from './doc-categories-shared';

const region = process.env.AWS_REGION ?? 'eu-west-1';
const tableName = process.env.TABLE_NAME!;
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region }));

const json = (statusCode: number, body: unknown) => ({
  statusCode,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

/**
 * Deleting a category does NOT touch existing documents — their stored
 * `category` string remains, the category just disappears from the
 * upload dropdown for new docs. Existing docs are still listed with
 * their old category label.
 */
export const handler = async (event: APIGatewayProxyEventV2WithJWTAuthorizer) => {
  if (!event.requestContext.authorizer?.jwt?.claims) return json(401, { error: 'Unauthorized' });
  if (!canManageSystemConfig(event)) return json(403, { error: 'Forbidden — administrator only' });

  const key = event.pathParameters?.key ?? '';
  if (!key) return json(400, { error: 'Missing category key' });

  try {
    await ddb.send(
      new DeleteCommand({
        TableName: tableName,
        Key: { PK: DOCCATEGORYLIST_PK, SK: `${DOC_CATEGORY_SK_PREFIX}${key}` },
        ConditionExpression: 'attribute_exists(PK)',
      }),
    );
  } catch (err) {
    if (err instanceof ConditionalCheckFailedException) return json(404, { error: 'Category not found' });
    throw err;
  }

  return json(200, { key, deleted: true });
};
