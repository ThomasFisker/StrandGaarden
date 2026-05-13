import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';
import { ConditionalCheckFailedException, DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { canManageSystemConfig } from './permissions';
import { normalizeDisplayName } from './persons-shared';
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

  const key = event.pathParameters?.key ?? '';
  if (!key) return json(400, { error: 'Missing category key' });

  let body: Record<string, unknown>;
  try {
    body = JSON.parse(event.body ?? '{}');
  } catch {
    return json(400, { error: 'Request body must be valid JSON' });
  }

  const wantsRename = typeof body.displayName === 'string';
  const wantsReorder = typeof body.displayOrder === 'number';
  if (!wantsRename && !wantsReorder)
    return json(400, { error: 'Either displayName or displayOrder must be provided' });

  const sets: string[] = [];
  const values: Record<string, unknown> = {};
  if (wantsRename) {
    const displayName = normalizeDisplayName(body.displayName as string);
    if (!displayName) return json(400, { error: 'displayName cannot be empty' });
    if (displayName.length > NAME_MAX) return json(400, { error: `displayName max ${NAME_MAX} chars` });
    sets.push('displayName = :dn');
    values[':dn'] = displayName;
  }
  if (wantsReorder) {
    sets.push('displayOrder = :do');
    values[':do'] = body.displayOrder;
  }

  try {
    const r = await ddb.send(
      new UpdateCommand({
        TableName: tableName,
        Key: { PK: DOCCATEGORYLIST_PK, SK: `${DOC_CATEGORY_SK_PREFIX}${key}` },
        UpdateExpression: 'SET ' + sets.join(', '),
        ExpressionAttributeValues: values,
        ConditionExpression: 'attribute_exists(PK)',
        ReturnValues: 'ALL_NEW',
      }),
    );
    const it = r.Attributes ?? {};
    return json(200, {
      key,
      displayName: String(it.displayName ?? ''),
      displayOrder: typeof it.displayOrder === 'number' ? it.displayOrder : 0,
    });
  } catch (err) {
    if (err instanceof ConditionalCheckFailedException) return json(404, { error: 'Category not found' });
    throw err;
  }
};
