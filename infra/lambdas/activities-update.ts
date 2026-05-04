import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { ACTIVITY_SK_PREFIX, ACTIVITYLIST_PK } from './activities-shared';
import { isAdmin, json, normalizeDisplayName } from './persons-shared';

const region = process.env.AWS_REGION ?? 'eu-west-1';
const tableName = process.env.TABLE_NAME!;
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region }));

const NAME_MAX = 80;

export const handler = async (event: APIGatewayProxyEventV2WithJWTAuthorizer) => {
  if (!isAdmin(event)) return json(403, { error: 'Admin only' });

  const key = event.pathParameters?.key;
  if (!key) return json(400, { error: 'Missing key' });

  let body: Record<string, unknown>;
  try {
    body = JSON.parse(event.body ?? '{}');
  } catch {
    return json(400, { error: 'Request body must be valid JSON' });
  }

  const sets: string[] = [];
  const values: Record<string, unknown> = {};

  if (body.displayName !== undefined) {
    const displayName = normalizeDisplayName(typeof body.displayName === 'string' ? body.displayName : '');
    if (!displayName) return json(400, { error: 'displayName cannot be empty' });
    if (displayName.length > NAME_MAX) return json(400, { error: `displayName max ${NAME_MAX} chars` });
    sets.push('displayName = :dn');
    values[':dn'] = displayName;
  }
  if (body.displayOrder !== undefined) {
    const n = Number(body.displayOrder);
    if (!Number.isFinite(n)) return json(400, { error: 'displayOrder must be a number' });
    sets.push('displayOrder = :do');
    values[':do'] = n;
  }
  if (sets.length === 0) return json(400, { error: 'Nothing to update' });

  const result = await ddb
    .send(
      new UpdateCommand({
        TableName: tableName,
        Key: { PK: ACTIVITYLIST_PK, SK: `${ACTIVITY_SK_PREFIX}${key}` },
        UpdateExpression: `SET ${sets.join(', ')}`,
        ExpressionAttributeValues: values,
        ConditionExpression: 'attribute_exists(PK)',
        ReturnValues: 'ALL_NEW',
      }),
    )
    .catch((err) => {
      if (err.name === 'ConditionalCheckFailedException') return null;
      throw err;
    });

  if (!result) return json(404, { error: 'Aktivitet ikke fundet' });
  const it = result.Attributes ?? {};
  return json(200, {
    key: String(it.key ?? key),
    displayName: String(it.displayName ?? ''),
    displayOrder: typeof it.displayOrder === 'number' ? it.displayOrder : 0,
  });
};
