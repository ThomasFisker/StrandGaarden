import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { canViewDocs } from './permissions';
import { DOC_LIST_GSI1PK } from './documents-shared';

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

  const qs = event.queryStringParameters ?? {};
  const yearFilter = qs.year ? Number(qs.year) : null;
  const categoryFilter = typeof qs.category === 'string' && qs.category ? qs.category : null;
  const meetingFilter = typeof qs.meetingId === 'string' && qs.meetingId ? qs.meetingId : null;
  const q = typeof qs.q === 'string' ? qs.q.trim().toLowerCase() : '';

  const items: Record<string, unknown>[] = [];
  let ExclusiveStartKey: Record<string, unknown> | undefined;
  do {
    const r = await ddb.send(
      new QueryCommand({
        TableName: tableName,
        IndexName: 'GSI1',
        KeyConditionExpression: 'GSI1PK = :pk',
        ExpressionAttributeValues: { ':pk': DOC_LIST_GSI1PK },
        ScanIndexForward: false, // newest first
        ExclusiveStartKey,
      }),
    );
    for (const it of r.Items ?? []) items.push(it);
    ExclusiveStartKey = r.LastEvaluatedKey;
  } while (ExclusiveStartKey);

  let rows = items.map((it) => ({
    docId: String(it.docId ?? ''),
    title: String(it.title ?? ''),
    meetingId: typeof it.meetingId === 'string' ? it.meetingId : null,
    category: String(it.category ?? ''),
    year: typeof it.year === 'number' ? it.year : null,
    tags: Array.isArray(it.tags) ? (it.tags as unknown[]).map(String) : [],
    note: typeof it.note === 'string' ? it.note : null,
    contentType: String(it.contentType ?? ''),
    originalFilename: String(it.originalFilename ?? ''),
    uploadedAt: String(it.uploadedAt ?? ''),
    uploadedByEmail: typeof it.uploadedByEmail === 'string' ? it.uploadedByEmail : null,
  }));

  if (yearFilter !== null && !Number.isNaN(yearFilter))
    rows = rows.filter((r) => r.year === yearFilter);
  if (categoryFilter !== null) rows = rows.filter((r) => r.category === categoryFilter);
  if (meetingFilter !== null) rows = rows.filter((r) => r.meetingId === meetingFilter);
  if (q)
    rows = rows.filter(
      (r) =>
        r.title.toLowerCase().includes(q) ||
        r.tags.some((t) => t.toLowerCase().includes(q)) ||
        r.note?.toLowerCase().includes(q),
    );

  const years = Array.from(new Set(rows.map((r) => r.year).filter((y): y is number => y !== null))).sort(
    (a, b) => b - a,
  );
  const categories = Array.from(new Set(rows.map((r) => r.category).filter(Boolean))).sort((a, b) =>
    a.localeCompare(b, 'da'),
  );

  return json(200, { items: rows, filters: { years, categories } });
};
