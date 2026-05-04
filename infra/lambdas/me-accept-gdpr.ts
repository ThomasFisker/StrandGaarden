import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { getConfig } from './config-shared';
import { json, USER_SK, userPk } from './users-shared';

const region = process.env.AWS_REGION ?? 'eu-west-1';
const tableName = process.env.TABLE_NAME!;
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region }));

/** POST /me/gdpr-accept — record that the caller has accepted the
 * current GDPR text. Body must echo the version they saw so we don't
 * silently accept a stale one if the admin bumped it mid-flow. */
export const handler = async (event: APIGatewayProxyEventV2WithJWTAuthorizer) => {
  const claims = event.requestContext.authorizer?.jwt?.claims ?? {};
  const sub = typeof claims.sub === 'string' ? claims.sub : '';
  if (!sub) return json(401, { error: 'Unauthorized' });

  let body: { version?: unknown };
  try {
    body = JSON.parse(event.body ?? '{}');
  } catch {
    return json(400, { error: 'Request body must be valid JSON' });
  }
  const seenVersion = typeof body.version === 'string' ? body.version : '';
  if (!seenVersion) return json(400, { error: 'version is required' });

  const cfg = await getConfig(ddb, tableName);
  if (seenVersion !== cfg.gdprVersion) {
    return json(409, {
      error: 'Versionen er blevet opdateret. Læs den nye tekst og acceptér igen.',
      currentVersion: cfg.gdprVersion,
    });
  }

  const email = typeof claims.email === 'string' ? claims.email : null;
  const loginName = typeof claims.preferred_username === 'string' ? claims.preferred_username : null;
  const at = new Date().toISOString();

  await ddb.send(
    new UpdateCommand({
      TableName: tableName,
      Key: { PK: userPk(sub), SK: USER_SK },
      UpdateExpression:
        'SET entity = if_not_exists(entity, :ent), createdAt = if_not_exists(createdAt, :at), ' +
        'gdprAcceptedAt = :at, gdprAcceptedVersion = :ver, ' +
        'email = if_not_exists(email, :em), loginName = if_not_exists(loginName, :ln)',
      ExpressionAttributeValues: {
        ':ent': 'User',
        ':at': at,
        ':ver': cfg.gdprVersion,
        ':em': email,
        ':ln': loginName,
      },
    }),
  );

  return json(200, { gdprAcceptedAt: at, gdprAcceptedVersion: cfg.gdprVersion });
};
