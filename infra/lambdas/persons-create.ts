import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';
import { ConditionalCheckFailedException, DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import {
  isAdmin,
  json,
  normalizeDisplayName,
  PERSON_SK_PREFIX,
  PERSONLIST_PK,
  slugify,
} from './persons-shared';

const region = process.env.AWS_REGION ?? 'eu-west-1';
const tableName = process.env.TABLE_NAME!;

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region }));

const NAME_MAX = 120;

export const handler = async (event: APIGatewayProxyEventV2WithJWTAuthorizer) => {
  if (!isAdmin(event)) return json(403, { error: 'Admin only' });

  let body: Record<string, unknown>;
  try {
    body = JSON.parse(event.body ?? '{}');
  } catch {
    return json(400, { error: 'Request body must be valid JSON' });
  }

  const displayName = normalizeDisplayName(typeof body.displayName === 'string' ? body.displayName : '');
  if (!displayName) return json(400, { error: 'displayName is required' });
  if (displayName.length > NAME_MAX) return json(400, { error: `displayName max ${NAME_MAX} chars` });

  const slug = slugify(displayName);
  if (!slug) return json(400, { error: 'displayName must contain alphanumeric characters' });

  const claims = event.requestContext.authorizer?.jwt?.claims ?? {};
  const by = typeof claims.sub === 'string' ? claims.sub : '';
  const byEmail = typeof claims.email === 'string' ? claims.email : '';
  const at = new Date().toISOString();

  try {
    await ddb.send(
      new PutCommand({
        TableName: tableName,
        Item: {
          PK: PERSONLIST_PK,
          SK: `${PERSON_SK_PREFIX}${slug}`,
          entity: 'Person',
          slug,
          displayName,
          state: 'approved',
          proposedBy: by,
          proposedByEmail: byEmail,
          proposedAt: at,
          approvedBy: by,
          approvedByEmail: byEmail,
          approvedAt: at,
        },
        ConditionExpression: 'attribute_not_exists(PK)',
      }),
    );
  } catch (err) {
    if (err instanceof ConditionalCheckFailedException) {
      return json(409, { error: 'Navnet findes allerede — slug kollision', slug });
    }
    throw err;
  }

  return json(201, { slug, displayName, state: 'approved' });
};
