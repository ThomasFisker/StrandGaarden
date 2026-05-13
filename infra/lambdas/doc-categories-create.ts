import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';
import { ConditionalCheckFailedException, DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { canManageSystemConfig } from './permissions';
import { normalizeDisplayName, slugify } from './persons-shared';
import { DOCCATEGORYLIST_PK, DOC_CATEGORY_SK_PREFIX } from './doc-categories-shared';

const region = process.env.AWS_REGION ?? 'eu-west-1';
const tableName = process.env.TABLE_NAME!;
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region }));

const json = (statusCode: number, body: unknown) => ({
  statusCode,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

const NAME_MAX = 80;

export const handler = async (event: APIGatewayProxyEventV2WithJWTAuthorizer) => {
  const claims = event.requestContext.authorizer?.jwt?.claims;
  if (!claims) return json(401, { error: 'Unauthorized' });
  if (!canManageSystemConfig(event)) return json(403, { error: 'Forbidden — administrator only' });

  let body: Record<string, unknown>;
  try {
    body = JSON.parse(event.body ?? '{}');
  } catch {
    return json(400, { error: 'Request body must be valid JSON' });
  }

  const displayName = normalizeDisplayName(typeof body.displayName === 'string' ? body.displayName : '');
  if (!displayName) return json(400, { error: 'displayName is required' });
  if (displayName.length > NAME_MAX) return json(400, { error: `displayName max ${NAME_MAX} chars` });

  const key = slugify(displayName);
  if (!key) return json(400, { error: 'displayName must contain alphanumeric characters' });

  const displayOrder = typeof body.displayOrder === 'number' ? body.displayOrder : 1000;

  const by = typeof claims.sub === 'string' ? claims.sub : '';
  const byEmail = typeof claims.email === 'string' ? claims.email : '';
  const at = new Date().toISOString();

  try {
    await ddb.send(
      new PutCommand({
        TableName: tableName,
        Item: {
          PK: DOCCATEGORYLIST_PK,
          SK: `${DOC_CATEGORY_SK_PREFIX}${key}`,
          entity: 'DocCategory',
          key,
          displayName,
          displayOrder,
          createdAt: at,
          createdBy: by,
          createdByEmail: byEmail,
        },
        ConditionExpression: 'attribute_not_exists(PK)',
      }),
    );
  } catch (err) {
    if (err instanceof ConditionalCheckFailedException) {
      return json(409, { error: 'En kategori med samme nøgle findes allerede', key });
    }
    throw err;
  }

  return json(201, { key, displayName, displayOrder, createdAt: at });
};
