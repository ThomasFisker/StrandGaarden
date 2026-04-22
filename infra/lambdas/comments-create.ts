import { randomUUID } from 'node:crypto';
import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';

const region = process.env.AWS_REGION ?? 'eu-west-1';
const tableName = process.env.TABLE_NAME!;

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region }));

const BODY_MAX = 2000;
const BODY_MIN = 1;

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

const primaryRole = (groups: string[]): string => {
  if (groups.includes('admin')) return 'admin';
  if (groups.includes('member')) return 'member';
  if (groups.includes('viewer')) return 'viewer';
  return 'unknown';
};

export const handler = async (event: APIGatewayProxyEventV2WithJWTAuthorizer) => {
  const claims = event.requestContext.authorizer?.jwt?.claims ?? {};
  const authorSub = typeof claims.sub === 'string' ? claims.sub : '';
  if (!authorSub) return json(401, { error: 'Missing subject claim' });

  const photoId = event.pathParameters?.id;
  if (!photoId || !/^[0-9a-f-]{36}$/.test(photoId)) return json(400, { error: 'Ugyldigt billede-id' });

  let reqBody: Record<string, unknown>;
  try {
    reqBody = JSON.parse(event.body ?? '{}');
  } catch {
    return json(400, { error: 'Request body must be valid JSON' });
  }

  const body = typeof reqBody.body === 'string' ? reqBody.body.trim() : '';
  if (body.length < BODY_MIN) return json(400, { error: 'Kommentaren må ikke være tom' });
  if (body.length > BODY_MAX) return json(400, { error: `Kommentaren er for lang (maks ${BODY_MAX} tegn)` });

  const photo = await ddb.send(
    new GetCommand({
      TableName: tableName,
      Key: { PK: `PHOTO#${photoId}`, SK: 'META' },
      ProjectionExpression: '#s, visibilityWeb',
      ExpressionAttributeNames: { '#s': 'status' },
    }),
  );
  if (!photo.Item || photo.Item.status !== 'Decided' || photo.Item.visibilityWeb !== true) {
    return json(404, { error: 'Billedet findes ikke' });
  }

  const commentId = randomUUID();
  const createdAt = new Date().toISOString();
  const authorRole = primaryRole(parseGroups(claims['cognito:groups']));
  const authorLoginName =
    typeof claims.preferred_username === 'string' ? claims.preferred_username : '';
  const authorEmail = typeof claims.email === 'string' ? claims.email : '';

  await ddb.send(
    new PutCommand({
      TableName: tableName,
      Item: {
        PK: `PHOTO#${photoId}`,
        SK: `COMMENT#${createdAt}#${commentId}`,
        entity: 'Comment',
        commentId,
        photoId,
        body,
        authorSub,
        authorLoginName,
        authorEmail,
        authorRole,
        status: 'pending',
        createdAt,
        GSI1PK: 'COMMENTSTATUS#pending',
        GSI1SK: `${createdAt}#${commentId}`,
      },
    }),
  );

  return json(201, { commentId, photoId, status: 'pending' });
};
