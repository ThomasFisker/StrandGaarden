import { randomUUID } from 'node:crypto';
import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
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

  const meetingId = randomUUID();
  const now = new Date().toISOString();
  const createdBySub = String(claims.sub ?? '');
  const createdByEmail = typeof claims.email === 'string' ? claims.email : null;

  await ddb.send(
    new PutCommand({
      TableName: tableName,
      Item: {
        PK: meetingPk(meetingId),
        SK: META_SK,
        entity: 'Meeting',
        meetingId,
        kind,
        date,
        title,
        description,
        createdAt: now,
        createdBySub,
        createdByEmail,
        GSI1PK: MEETING_LIST_GSI1PK,
        GSI1SK: `${date}#${meetingId}`,
      },
      ConditionExpression: 'attribute_not_exists(PK)',
    }),
  );

  return json(201, { meetingId, createdAt: now });
};
