import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, DeleteCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';

const region = process.env.AWS_REGION ?? 'eu-west-1';
const tableName = process.env.TABLE_NAME!;

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region }));

const json = (statusCode: number, body: unknown) => ({
  statusCode,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});
const jsonNoContent = (statusCode: number) => ({ statusCode, headers: {}, body: '' });

const parseGroups = (raw: unknown): string[] => {
  if (Array.isArray(raw)) return raw.map(String);
  if (typeof raw === 'string') return raw.replace(/^\[|\]$/g, '').split(/[\s,]+/).filter(Boolean);
  return [];
};

export const handler = async (event: APIGatewayProxyEventV2WithJWTAuthorizer) => {
  const claims = event.requestContext.authorizer?.jwt?.claims ?? {};
  const groups = parseGroups(claims['cognito:groups']);
  if (!groups.includes('admin')) return json(403, { error: 'Admin only' });

  const photoId = event.pathParameters?.photoId;
  const commentId = event.pathParameters?.commentId;
  if (!photoId || !/^[0-9a-f-]{36}$/.test(photoId)) return json(400, { error: 'Ugyldigt billede-id' });
  if (!commentId || !/^[0-9a-f-]{36}$/.test(commentId)) return json(400, { error: 'Ugyldig kommentar-id' });

  const r = await ddb.send(
    new QueryCommand({
      TableName: tableName,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      ExpressionAttributeValues: { ':pk': `PHOTO#${photoId}`, ':sk': 'COMMENT#' },
    }),
  );
  const match = (r.Items ?? []).find((it) => String(it.commentId) === commentId);
  if (!match) return json(404, { error: 'Kommentaren findes ikke' });

  await ddb.send(new DeleteCommand({ TableName: tableName, Key: { PK: match.PK, SK: match.SK } }));
  return jsonNoContent(204);
};
