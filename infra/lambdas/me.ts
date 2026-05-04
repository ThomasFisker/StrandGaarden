import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';
import { json, parseGroups, USER_SK, userPk } from './users-shared';

const region = process.env.AWS_REGION ?? 'eu-west-1';
const tableName = process.env.TABLE_NAME!;
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region }));

/** GET /me — returns the caller's own profile row.
 *
 * Used by the Upload form to prefill the user's assigned house, and by the
 * (upcoming) GDPR consent flow to know whether the user has already
 * accepted the current version. Any authed user can call this for their
 * own row; the row may be absent (returns null fields) for users whose
 * admin never assigned a house. */
export const handler = async (event: APIGatewayProxyEventV2WithJWTAuthorizer) => {
  const claims = event.requestContext.authorizer?.jwt?.claims ?? {};
  const sub = typeof claims.sub === 'string' ? claims.sub : '';
  if (!sub) return json(401, { error: 'Unauthorized' });

  const r = await ddb.send(
    new GetCommand({ TableName: tableName, Key: { PK: userPk(sub), SK: USER_SK } }),
  );
  const it = r.Item ?? {};

  return json(200, {
    sub,
    email: typeof claims.email === 'string' ? claims.email : null,
    loginName: typeof claims.preferred_username === 'string' ? claims.preferred_username : null,
    groups: parseGroups(claims['cognito:groups']),
    houseNumber: typeof it.houseNumber === 'number' ? it.houseNumber : null,
    gdprAcceptedAt: typeof it.gdprAcceptedAt === 'string' ? it.gdprAcceptedAt : null,
    gdprAcceptedVersion: typeof it.gdprAcceptedVersion === 'string' ? it.gdprAcceptedVersion : null,
  });
};
