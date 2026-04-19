import { randomUUID } from 'node:crypto';
import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const region = process.env.AWS_REGION ?? 'eu-west-1';
const tableName = process.env.TABLE_NAME!;
const originalsBucket = process.env.ORIGINALS_BUCKET!;

const s3 = new S3Client({ region });
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region }));

const ACCEPTED_CONTENT_TYPES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/tiff': 'tif',
  'image/heic': 'heic',
  'image/heif': 'heif',
};
const MAX_BYTES = 100 * 1024 * 1024;
const URL_TTL_SECONDS = 300;
const FILENAME_MAX = 255;

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
  if (!groups.some((g) => g === 'admin' || g === 'member')) {
    return json(403, { error: 'Upload is restricted to admin and member roles' });
  }

  let body: { filename?: unknown; contentType?: unknown };
  try {
    body = JSON.parse(event.body ?? '{}');
  } catch {
    return json(400, { error: 'Request body must be valid JSON' });
  }

  const filename = typeof body.filename === 'string' ? body.filename.trim() : '';
  const contentType = typeof body.contentType === 'string' ? body.contentType.trim().toLowerCase() : '';

  if (!filename || filename.length > FILENAME_MAX) {
    return json(400, { error: `filename is required (max ${FILENAME_MAX} chars)` });
  }

  const ext = ACCEPTED_CONTENT_TYPES[contentType];
  if (!ext) {
    return json(400, {
      error: `contentType must be one of: ${Object.keys(ACCEPTED_CONTENT_TYPES).join(', ')}`,
    });
  }

  const photoId = randomUUID();
  const s3Key = `photos/${photoId}.${ext}`;
  const createdAt = new Date().toISOString();

  await ddb.send(
    new PutCommand({
      TableName: tableName,
      Item: {
        PK: `PHOTO#${photoId}`,
        SK: 'META',
        entity: 'Photo',
        status: 'Uploaded',
        photoId,
        s3Key,
        originalFilename: filename,
        contentType,
        uploaderSub: claims.sub,
        uploaderEmail: claims.email,
        createdAt,
        GSI1PK: 'STATUS#Uploaded',
        GSI1SK: `${createdAt}#${photoId}`,
      },
      ConditionExpression: 'attribute_not_exists(PK)',
    }),
  );

  const uploadUrl = await getSignedUrl(
    s3,
    new PutObjectCommand({
      Bucket: originalsBucket,
      Key: s3Key,
      ContentType: contentType,
    }),
    { expiresIn: URL_TTL_SECONDS },
  );

  return json(201, {
    photoId,
    uploadUrl,
    expiresIn: URL_TTL_SECONDS,
    maxBytes: MAX_BYTES,
    s3Key,
  });
};
