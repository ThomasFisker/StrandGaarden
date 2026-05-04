import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { getConfig } from './config-shared';
import { json } from './users-shared';

const region = process.env.AWS_REGION ?? 'eu-west-1';
const tableName = process.env.TABLE_NAME!;
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region }));

/** GET /gdpr-text — returns the current GDPR text + version.
 *
 * Authed-only; fetched on demand by the consent gate when the user needs
 * to accept (kept off /me so the text payload doesn't ride on every
 * profile fetch). */
export const handler = async (event: APIGatewayProxyEventV2WithJWTAuthorizer) => {
  if (!event.requestContext.authorizer?.jwt?.claims) return json(401, { error: 'Unauthorized' });
  const cfg = await getConfig(ddb, tableName);
  return json(200, { version: cfg.gdprVersion, text: cfg.gdprText });
};
