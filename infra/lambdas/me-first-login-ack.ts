import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { json, USER_SK, userPk } from './users-shared';

const region = process.env.AWS_REGION ?? 'eu-west-1';
const tableName = process.env.TABLE_NAME!;
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region }));

/** POST /me/first-login-ack — record that the caller has been offered
 * the optional "set your own password" prompt and either accepted or
 * dismissed it. The flag suppresses the prompt for all future logins.
 *
 * No body. Idempotent — second call is a no-op. */
export const handler = async (event: APIGatewayProxyEventV2WithJWTAuthorizer) => {
  const claims = event.requestContext.authorizer?.jwt?.claims ?? {};
  const sub = typeof claims.sub === 'string' ? claims.sub : '';
  if (!sub) return json(401, { error: 'Unauthorized' });

  const at = new Date().toISOString();
  const email = typeof claims.email === 'string' ? claims.email : null;
  const loginName =
    typeof claims.preferred_username === 'string' ? claims.preferred_username : null;

  await ddb.send(
    new UpdateCommand({
      TableName: tableName,
      Key: { PK: userPk(sub), SK: USER_SK },
      UpdateExpression:
        'SET entity = if_not_exists(entity, :ent), createdAt = if_not_exists(createdAt, :at), ' +
        'firstLoginAcked = :true, firstLoginAckedAt = if_not_exists(firstLoginAckedAt, :at), ' +
        'email = if_not_exists(email, :em), loginName = if_not_exists(loginName, :ln)',
      ExpressionAttributeValues: {
        ':ent': 'User',
        ':at': at,
        ':true': true,
        ':em': email,
        ':ln': loginName,
      },
    }),
  );

  return json(200, { firstLoginAcked: true });
};
