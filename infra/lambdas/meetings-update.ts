import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';
import { DynamoDBClient, ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { canManageDocs } from './permissions';
import {
  isIsoDate,
  isMeetingKind,
  MEETING_DESCRIPTION_MAX,
  MEETING_LIST_GSI1PK,
  MEETING_TITLE_MAX,
  META_SK,
  meetingPk,
} from './documents-shared';

const region = process.env.AWS_REGION ?? 'eu-west-1';
const tableName = process.env.TABLE_NAME!;
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region }));

const json = (statusCode: number, body: unknown) => ({
  statusCode,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

export const handler = async (event: APIGatewayProxyEventV2WithJWTAuthorizer) => {
  const claims = event.requestContext.authorizer?.jwt?.claims;
  if (!claims) return json(401, { error: 'Unauthorized' });
  if (!canManageDocs(event)) return json(403, { error: 'Forbidden' });

  const meetingId = event.pathParameters?.id ?? '';
  if (!meetingId) return json(400, { error: 'Missing meeting id' });

  let body: Record<string, unknown> = {};
  try {
    body = event.body ? JSON.parse(event.body) : {};
  } catch {
    return json(400, { error: 'Invalid JSON body' });
  }

  const kind = body.kind;
  const date = body.date;
  const title = typeof body.title === 'string' ? body.title.trim() : '';
  const description = typeof body.description === 'string' ? body.description.trim() : '';

  const errors: string[] = [];
  if (!isMeetingKind(kind)) errors.push('kind must be "board" or "assembly"');
  if (!isIsoDate(date)) errors.push('date must be YYYY-MM-DD');
  if (!title) errors.push('title required');
  if (title.length > MEETING_TITLE_MAX) errors.push(`title max ${MEETING_TITLE_MAX} chars`);
  if (description.length > MEETING_DESCRIPTION_MAX)
    errors.push(`description max ${MEETING_DESCRIPTION_MAX} chars`);
  if (errors.length) return json(400, { error: 'Invalid input', details: errors });

  const existing = await ddb.send(
    new GetCommand({ TableName: tableName, Key: { PK: meetingPk(meetingId), SK: META_SK } }),
  );
  if (!existing.Item) return json(404, { error: 'Meeting not found' });

  const now = new Date().toISOString();
  try {
    await ddb.send(
      new UpdateCommand({
        TableName: tableName,
        Key: { PK: meetingPk(meetingId), SK: META_SK },
        UpdateExpression:
          'SET kind = :k, #d = :date, title = :t, description = :desc, ' +
          'GSI1PK = :gsi1pk, GSI1SK = :gsi1sk, lastEditedAt = :at, lastEditedBy = :by',
        ConditionExpression: 'attribute_exists(PK)',
        ExpressionAttributeNames: { '#d': 'date' },
        ExpressionAttributeValues: {
          ':k': kind,
          ':date': date,
          ':t': title,
          ':desc': description,
          ':gsi1pk': MEETING_LIST_GSI1PK,
          ':gsi1sk': `${date}#${meetingId}`,
          ':at': now,
          ':by': typeof claims.email === 'string' ? claims.email : String(claims.sub ?? ''),
        },
      }),
    );
  } catch (err) {
    if (err instanceof ConditionalCheckFailedException) return json(404, { error: 'Meeting not found' });
    throw err;
  }

  return json(200, { meetingId, updatedAt: now });
};
