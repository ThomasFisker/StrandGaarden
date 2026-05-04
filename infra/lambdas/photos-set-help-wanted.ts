import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';
import { ConditionalCheckFailedException, DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { FREEZE_ERROR_MESSAGE, getConfig, isFrozenForCaller } from './config-shared';

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
  const callerSub = typeof claims.sub === 'string' ? claims.sub : '';
  const isAdmin = groups.includes('admin');

  const photoId = event.pathParameters?.id;
  if (!photoId || !/^[0-9a-f-]{36}$/.test(photoId)) return json(400, { error: 'Ugyldigt billede-id' });

  const cfg = await getConfig(ddb, tableName);
  if (isFrozenForCaller(cfg, isAdmin)) {
    return json(423, { error: FREEZE_ERROR_MESSAGE });
  }

  let body: Record<string, unknown>;
  try {
    body = JSON.parse(event.body ?? '{}');
  } catch {
    return json(400, { error: 'Request body must be valid JSON' });
  }
  if (typeof body.helpWanted !== 'boolean') {
    return json(400, { error: 'helpWanted (boolean) is required' });
  }
  const helpWanted = body.helpWanted;

  try {
    await ddb.send(
      new UpdateCommand({
        TableName: tableName,
        Key: { PK: `PHOTO#${photoId}`, SK: 'META' },
        ConditionExpression: isAdmin
          ? 'attribute_exists(PK)'
          : 'attribute_exists(PK) AND uploaderSub = :caller',
        UpdateExpression: 'SET helpWanted = :hw',
        ExpressionAttributeValues: isAdmin
          ? { ':hw': helpWanted }
          : { ':hw': helpWanted, ':caller': callerSub },
      }),
    );
  } catch (err) {
    if (err instanceof ConditionalCheckFailedException) {
      return json(403, { error: 'Kun uploaderen eller en administrator kan ændre dette flag' });
    }
    throw err;
  }

  return json(200, { photoId, helpWanted });
};
