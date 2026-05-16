import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { canViewDocs } from './permissions';
import { DOC_URL_TTL_SECONDS, docPk, META_SK, meetingPk } from './documents-shared';

const region = process.env.AWS_REGION ?? 'eu-west-1';
const tableName = process.env.TABLE_NAME!;
const originalsBucket = process.env.ORIGINALS_BUCKET!;
const s3 = new S3Client({ region });
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region }));

const json = (statusCode: number, body: unknown) => ({
  statusCode,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

export const handler = async (event: APIGatewayProxyEventV2WithJWTAuthorizer) => {
  if (!event.requestContext.authorizer?.jwt?.claims) return json(401, { error: 'Unauthorized' });
  if (!canViewDocs(event)) return json(403, { error: 'Forbidden' });

  const docId = event.pathParameters?.id ?? '';
  if (!docId) return json(400, { error: 'Missing doc id' });

  const r = await ddb.send(
    new GetCommand({ TableName: tableName, Key: { PK: docPk(docId), SK: META_SK } }),
  );
  if (!r.Item) return json(404, { error: 'Document not found' });
  const it = r.Item;

  const originalFilename = String(it.originalFilename ?? 'dokument');
  const s3Key = String(it.s3Key ?? '');
  if (!s3Key) return json(500, { error: 'Document has no s3Key' });

  const dispositionFilename = originalFilename.replace(/"/g, '');
  const contentType = String(it.contentType ?? '');
  const [downloadUrl, viewUrl] = await Promise.all([
    getSignedUrl(
      s3,
      new GetObjectCommand({
        Bucket: originalsBucket,
        Key: s3Key,
        ResponseContentDisposition: `attachment; filename="${dispositionFilename}"`,
      }),
      { expiresIn: DOC_URL_TTL_SECONDS },
    ),
    // Inline-disposition URL drives in-browser PDF rendering via <iframe>
    // on /dokumenter/:id. The S3 response also overrides Content-Type so
    // Safari/Firefox don't second-guess the stored value.
    getSignedUrl(
      s3,
      new GetObjectCommand({
        Bucket: originalsBucket,
        Key: s3Key,
        ResponseContentDisposition: `inline; filename="${dispositionFilename}"`,
        ResponseContentType: contentType || undefined,
      }),
      { expiresIn: DOC_URL_TTL_SECONDS },
    ),
  ]);

  // If linked to a meeting, fetch the meeting metadata too — saves the
  // SPA a follow-up call.
  let meeting: Record<string, unknown> | null = null;
  if (typeof it.meetingId === 'string' && it.meetingId) {
    const m = await ddb.send(
      new GetCommand({ TableName: tableName, Key: { PK: meetingPk(it.meetingId), SK: META_SK } }),
    );
    if (m.Item) {
      meeting = {
        meetingId: it.meetingId,
        kind: String(m.Item.kind ?? ''),
        date: String(m.Item.date ?? ''),
        title: String(m.Item.title ?? ''),
      };
    }
  }

  return json(200, {
    docId,
    title: String(it.title ?? ''),
    meetingId: typeof it.meetingId === 'string' ? it.meetingId : null,
    meeting,
    category: String(it.category ?? ''),
    year: typeof it.year === 'number' ? it.year : null,
    tags: Array.isArray(it.tags) ? (it.tags as unknown[]).map(String) : [],
    note: typeof it.note === 'string' ? it.note : null,
    summary: typeof it.summary === 'string' ? it.summary : null,
    contentType,
    originalFilename,
    uploadedAt: String(it.uploadedAt ?? ''),
    uploadedByEmail: typeof it.uploadedByEmail === 'string' ? it.uploadedByEmail : null,
    downloadUrl,
    viewUrl,
    downloadExpiresIn: DOC_URL_TTL_SECONDS,
  });
};
