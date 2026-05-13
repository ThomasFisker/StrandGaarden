import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { canViewDocs } from './permissions';
import { MEETING_LIST_GSI1PK } from './documents-shared';

const region = process.env.AWS_REGION ?? 'eu-west-1';
const tableName = process.env.TABLE_NAME!;
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region }));

const json = (statusCode: number, body: unknown) => ({
  statusCode,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

export const handler = async (event: APIGatewayProxyEventV2WithJWTAuthorizer) => {
  if (!event.requestContext.authorizer?.jwt?.claims) return json(401, { error: 'Unauthorized' });
  if (!canViewDocs(event)) return json(403, { error: 'Forbidden' });

  const items: Record<string, unknown>[] = [];
  let ExclusiveStartKey: Record<string, unknown> | undefined;
  do {
    const r = await ddb.send(
      new QueryCommand({
        TableName: tableName,
        IndexName: 'GSI1',
        KeyConditionExpression: 'GSI1PK = :pk',
        ExpressionAttributeValues: { ':pk': MEETING_LIST_GSI1PK },
        ScanIndexForward: false, // newest first
        ExclusiveStartKey,
      }),
    );
    for (const it of r.Items ?? []) items.push(it);
    ExclusiveStartKey = r.LastEvaluatedKey;
  } while (ExclusiveStartKey);

  const rows = items.map((it) => ({
    meetingId: String(it.meetingId ?? ''),
    kind: String(it.kind ?? ''),
    date: String(it.date ?? ''),
    title: String(it.title ?? ''),
    description: typeof it.description === 'string' ? it.description : '',
    createdAt: String(it.createdAt ?? ''),
    createdByEmail: typeof it.createdByEmail === 'string' ? it.createdByEmail : null,
  }));

  return json(200, { items: rows });
};
