import { randomUUID } from 'node:crypto';
import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { canManageDocs } from './permissions';
import {
  ACCEPTED_DOC_CONTENT_TYPES,
  DOC_LIST_GSI1PK,
  DOC_MAX_BYTES,
  DOC_NOTE_MAX,
  DOC_TAG_MAX,
  DOC_TAGS_MAX_COUNT,
  DOC_TITLE_MAX,
  DOC_UPLOAD_URL_TTL_SECONDS,
  docPk,
  FILENAME_MAX,
  isPositiveInt,
  META_SK,
  meetingPk,
  safeFilename,
} from './documents-shared';
import { loadDocCategoryNames } from './doc-categories-shared';

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

const CURRENT_YEAR = new Date().getUTCFullYear();
const YEAR_MIN = 1900;

/**
 * Issues a presigned PUT URL for a document upload and writes the DDB
 * stub row. The client then uploads the file directly to S3. Mirrors
 * upload-url.ts (photo path).
 */
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

  const filenameRaw = body.filename;
  const contentType = body.contentType;
  const title = typeof body.title === 'string' ? body.title.trim() : '';
  const category = body.category;
  const year = body.year;
  const meetingId = typeof body.meetingId === 'string' && body.meetingId ? body.meetingId : null;
  const note = typeof body.note === 'string' ? body.note.trim() : '';
  const tagsRaw = Array.isArray(body.tags) ? body.tags : [];

  const errors: string[] = [];
  if (typeof filenameRaw !== 'string' || !filenameRaw.trim()) errors.push('filename required');
  if (typeof contentType !== 'string' || !(contentType in ACCEPTED_DOC_CONTENT_TYPES))
    errors.push(`contentType must be one of: ${Object.keys(ACCEPTED_DOC_CONTENT_TYPES).join(', ')}`);
  if (!title) errors.push('title required');
  if (title.length > DOC_TITLE_MAX) errors.push(`title max ${DOC_TITLE_MAX} chars`);
  if (typeof category !== 'string' || !category) {
    errors.push('category required');
  } else {
    const validCategoryNames = await loadDocCategoryNames(ddb, tableName);
    if (!validCategoryNames.has(category))
      errors.push(`category must be one of the registered values (manage at /bestyrelse/dokument-kategorier)`);
  }
  if (!isPositiveInt(year) || (year as number) < YEAR_MIN || (year as number) > CURRENT_YEAR + 1)
    errors.push(`year must be a positive integer between ${YEAR_MIN} and ${CURRENT_YEAR + 1}`);
  if (note.length > DOC_NOTE_MAX) errors.push(`note max ${DOC_NOTE_MAX} chars`);

  const tags: string[] = [];
  for (const t of tagsRaw) {
    if (typeof t !== 'string') {
      errors.push('tags must be strings');
      break;
    }
    const trimmed = t.trim();
    if (!trimmed) continue;
    if (trimmed.length > DOC_TAG_MAX) {
      errors.push(`tag max ${DOC_TAG_MAX} chars`);
      break;
    }
    tags.push(trimmed);
  }
  if (tags.length > DOC_TAGS_MAX_COUNT) errors.push(`max ${DOC_TAGS_MAX_COUNT} tags`);

  if (errors.length) return json(400, { error: 'Invalid input', details: errors });

  // Verify meeting exists if linked.
  if (meetingId) {
    const m = await ddb.send(
      new GetCommand({ TableName: tableName, Key: { PK: meetingPk(meetingId), SK: META_SK } }),
    );
    if (!m.Item) return json(400, { error: 'meetingId references unknown meeting' });
  }

  const docId = randomUUID();
  const ext = ACCEPTED_DOC_CONTENT_TYPES[contentType as string];
  const safe = safeFilename(filenameRaw as string) || `dokument.${ext}`;
  if (safe.length > FILENAME_MAX) return json(400, { error: 'filename too long' });
  const s3Key = `documents/${docId}/${safe}`;
  const now = new Date().toISOString();
  const date = now.slice(0, 10);
  const uploaderSub = String(claims.sub ?? '');
  const uploaderEmail = typeof claims.email === 'string' ? claims.email : null;

  const uploadUrl = await getSignedUrl(
    s3,
    new PutObjectCommand({
      Bucket: originalsBucket,
      Key: s3Key,
      ContentType: contentType as string,
    }),
    { expiresIn: DOC_UPLOAD_URL_TTL_SECONDS },
  );

  await ddb.send(
    new PutCommand({
      TableName: tableName,
      Item: {
        PK: docPk(docId),
        SK: META_SK,
        entity: 'Document',
        docId,
        title,
        meetingId,
        category,
        year,
        tags,
        note: note || null,
        s3Key,
        bytes: null, // filled in by client follow-up if we add it later; informational only
        originalFilename: safe,
        contentType,
        uploadedAt: now,
        uploadedBySub: uploaderSub,
        uploadedByEmail: uploaderEmail,
        GSI1PK: DOC_LIST_GSI1PK,
        GSI1SK: `${date}#${docId}`,
      },
      ConditionExpression: 'attribute_not_exists(PK)',
    }),
  );

  return json(201, {
    docId,
    uploadUrl,
    expiresIn: DOC_UPLOAD_URL_TTL_SECONDS,
    maxBytes: DOC_MAX_BYTES,
    s3Key,
  });
};
