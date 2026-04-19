import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import {
  isAdmin,
  json,
  normalizeDisplayName,
  PERSON_SK_PREFIX,
  PERSONLIST_PK,
} from './persons-shared';

const region = process.env.AWS_REGION ?? 'eu-west-1';
const tableName = process.env.TABLE_NAME!;

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region }));

const NAME_MAX = 120;

export const handler = async (event: APIGatewayProxyEventV2WithJWTAuthorizer) => {
  if (!isAdmin(event)) return json(403, { error: 'Admin only' });

  const slug = event.pathParameters?.slug;
  if (!slug) return json(400, { error: 'Missing slug' });

  let body: Record<string, unknown>;
  try {
    body = JSON.parse(event.body ?? '{}');
  } catch {
    return json(400, { error: 'Request body must be valid JSON' });
  }

  const rawName = typeof body.displayName === 'string' ? body.displayName : null;
  const targetState = body.state === 'approved' ? 'approved' : null;

  if (rawName === null && targetState === null) {
    return json(400, { error: 'Nothing to update (displayName and/or state required)' });
  }

  const names: string[] = [];
  const values: Record<string, unknown> = {};
  const attrNames: Record<string, string> = {};

  if (rawName !== null) {
    const displayName = normalizeDisplayName(rawName);
    if (!displayName) return json(400, { error: 'displayName cannot be empty' });
    if (displayName.length > NAME_MAX) return json(400, { error: `displayName max ${NAME_MAX} chars` });
    names.push('displayName = :dn');
    values[':dn'] = displayName;
  }

  if (targetState === 'approved') {
    const claims = event.requestContext.authorizer?.jwt?.claims ?? {};
    const by = typeof claims.sub === 'string' ? claims.sub : '';
    const byEmail = typeof claims.email === 'string' ? claims.email : '';
    const at = new Date().toISOString();
    names.push('#s = :approved');
    names.push('approvedBy = :by');
    names.push('approvedByEmail = :byEmail');
    names.push('approvedAt = :at');
    attrNames['#s'] = 'state';
    values[':approved'] = 'approved';
    values[':by'] = by;
    values[':byEmail'] = byEmail;
    values[':at'] = at;
  }

  const result = await ddb.send(
    new UpdateCommand({
      TableName: tableName,
      Key: { PK: PERSONLIST_PK, SK: `${PERSON_SK_PREFIX}${slug}` },
      UpdateExpression: `SET ${names.join(', ')}`,
      ExpressionAttributeValues: values,
      ...(Object.keys(attrNames).length ? { ExpressionAttributeNames: attrNames } : {}),
      ConditionExpression: 'attribute_exists(PK)',
      ReturnValues: 'ALL_NEW',
    }),
  ).catch((err) => {
    if (err.name === 'ConditionalCheckFailedException') return null;
    throw err;
  });

  if (!result) return json(404, { error: 'Person ikke fundet' });

  const item = result.Attributes ?? {};
  return json(200, {
    slug: String(item.slug ?? slug),
    displayName: String(item.displayName ?? ''),
    state: String(item.state ?? ''),
  });
};
