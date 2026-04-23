import { randomUUID } from 'node:crypto';
import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';

const region = process.env.AWS_REGION ?? 'eu-west-1';
const tableName = process.env.TABLE_NAME!;

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region }));

const REASON_MAX = 1000;

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
  const requestorSub = typeof claims.sub === 'string' ? claims.sub : '';
  if (!requestorSub) return json(401, { error: 'Missing subject claim' });

  const photoId = event.pathParameters?.id;
  if (!photoId || !/^[0-9a-f-]{36}$/.test(photoId)) return json(400, { error: 'Ugyldigt billede-id' });

  let reqBody: Record<string, unknown>;
  try {
    reqBody = JSON.parse(event.body ?? '{}');
  } catch {
    return json(400, { error: 'Request body must be valid JSON' });
  }

  const reason = typeof reqBody.reason === 'string' ? reqBody.reason.trim() : '';
  if (!reason) return json(400, { error: 'Skriv venligst en kort begrundelse' });
  if (reason.length > REASON_MAX) return json(400, { error: `Begrundelsen er for lang (maks ${REASON_MAX} tegn)` });

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

  const removalId = randomUUID();
  const createdAt = new Date().toISOString();
  const requestorRole = primaryRole(parseGroups(claims['cognito:groups']));
  const requestorLoginName =
    typeof claims.preferred_username === 'string' ? claims.preferred_username : '';
  const requestorEmail = typeof claims.email === 'string' ? claims.email : '';

  await ddb.send(
    new PutCommand({
      TableName: tableName,
      Item: {
        PK: `PHOTO#${photoId}`,
        SK: `REMOVAL#${createdAt}#${removalId}`,
        entity: 'Removal',
        removalId,
        photoId,
        reason,
        requestorSub,
        requestorLoginName,
        requestorEmail,
        requestorRole,
        status: 'pending',
        createdAt,
        GSI1PK: 'REMOVALSTATUS#pending',
        GSI1SK: `${createdAt}#${removalId}`,
      },
    }),
  );

  return json(201, { removalId, photoId, status: 'pending' });
};
