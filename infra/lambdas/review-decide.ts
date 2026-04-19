import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';
import { DynamoDBClient, ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';

const region = process.env.AWS_REGION ?? 'eu-west-1';
const tableName = process.env.TABLE_NAME!;

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region }));

const json = (statusCode: number, body: unknown) => ({
  statusCode,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

const parseGroups = (raw: unknown): string[] => {
  if (Array.isArray(raw)) return raw.map(String);
  if (typeof raw === 'string') return raw.replace(/^\[|\]$/g, '').split(/[\s,]+/).filter(Boolean);
  return [];
};

export const handler = async (event: APIGatewayProxyEventV2WithJWTAuthorizer) => {
  const claims = event.requestContext.authorizer?.jwt?.claims ?? {};
  const groups = parseGroups(claims['cognito:groups']);
  if (!groups.includes('admin')) return json(403, { error: 'Decision is restricted to admins' });

  const photoId = event.pathParameters?.id;
  if (!photoId || !/^[0-9a-f-]{36}$/.test(photoId)) return json(400, { error: 'Invalid photo id' });

  let body: Record<string, unknown>;
  try {
    body = JSON.parse(event.body ?? '{}');
  } catch {
    return json(400, { error: 'Request body must be valid JSON' });
  }
  const visibilityWeb = body.visibilityWeb === true;
  const visibilityBook = body.visibilityBook === true;

  const decidedAt = new Date().toISOString();
  const decidedBy = typeof claims.email === 'string' ? claims.email : String(claims.sub ?? 'unknown');

  try {
    await ddb.send(
      new UpdateCommand({
        TableName: tableName,
        Key: { PK: `PHOTO#${photoId}`, SK: 'META' },
        ConditionExpression: '#s IN (:inReview, :decided)',
        UpdateExpression:
          'SET #s = :decided, visibilityWeb = :vw, visibilityBook = :vb, decidedAt = :d, decidedBy = :by, ' +
          'GSI1PK = :gpk, GSI1SK = :gsk',
        ExpressionAttributeNames: { '#s': 'status' },
        ExpressionAttributeValues: {
          ':inReview': 'In Review',
          ':decided': 'Decided',
          ':vw': visibilityWeb,
          ':vb': visibilityBook,
          ':d': decidedAt,
          ':by': decidedBy,
          ':gpk': 'STATUS#Decided',
          ':gsk': `${decidedAt}#${photoId}`,
        },
      }),
    );
  } catch (err) {
    if (err instanceof ConditionalCheckFailedException) {
      return json(409, { error: 'Photo is not in a reviewable state (must be In Review or Decided)' });
    }
    throw err;
  }

  await ddb.send(
    new PutCommand({
      TableName: tableName,
      Item: {
        PK: `PHOTO#${photoId}`,
        SK: `AUDIT#${decidedAt}#decided`,
        entity: 'Audit',
        event: 'Decided',
        at: decidedAt,
        by: decidedBy,
        details: { visibilityWeb, visibilityBook },
      },
    }),
  );

  return json(200, { photoId, status: 'Decided', visibilityWeb, visibilityBook, decidedAt, decidedBy });
};
