import { randomUUID } from 'node:crypto';
import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { normalizeDisplayName, PERSON_SK_PREFIX, PERSONLIST_PK, slugify } from './persons-shared';

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
const DESCRIPTION_MAX = 2000;
const WHO_IN_PHOTO_MAX = 1000;
const HOUSE_MIN = 1;
const HOUSE_MAX = 23;
const YEAR_MIN = 1800;

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

  let body: Record<string, unknown>;
  try {
    body = JSON.parse(event.body ?? '{}');
  } catch {
    return json(400, { error: 'Request body must be valid JSON' });
  }

  const errors: string[] = [];

  const filename = typeof body.filename === 'string' ? body.filename.trim() : '';
  const contentType = typeof body.contentType === 'string' ? body.contentType.trim().toLowerCase() : '';
  const description = typeof body.description === 'string' ? body.description.trim() : '';
  const whoInPhotoRaw = body.whoInPhoto;
  const whoInPhoto =
    typeof whoInPhotoRaw === 'string' ? whoInPhotoRaw.trim() : whoInPhotoRaw == null ? '' : null;
  const yearRaw = body.year;
  const year = yearRaw === null || yearRaw === undefined || yearRaw === '' ? null : Number(yearRaw);
  const yearApprox = body.yearApprox === true;
  const houseNumbersRaw = body.houseNumbers;
  const consent = body.consent === true;
  const helpWanted = body.helpWanted === true;
  const currentYear = new Date().getFullYear();

  if (!filename || filename.length > FILENAME_MAX) {
    errors.push(`filename is required (max ${FILENAME_MAX} chars)`);
  }
  const ext = ACCEPTED_CONTENT_TYPES[contentType];
  if (!ext) {
    errors.push(`contentType must be one of: ${Object.keys(ACCEPTED_CONTENT_TYPES).join(', ')}`);
  }
  if (!description) errors.push('description is required');
  else if (description.length > DESCRIPTION_MAX) errors.push(`description max ${DESCRIPTION_MAX} chars`);
  if (whoInPhoto === null) errors.push('whoInPhoto must be a string when provided');
  else if (whoInPhoto.length > WHO_IN_PHOTO_MAX) errors.push(`whoInPhoto max ${WHO_IN_PHOTO_MAX} chars`);
  if (year !== null) {
    if (!Number.isInteger(year) || year < YEAR_MIN || year > currentYear) {
      errors.push(`year must be an integer between ${YEAR_MIN} and ${currentYear}`);
    }
  }
  if (!Array.isArray(houseNumbersRaw) || houseNumbersRaw.length === 0) {
    errors.push('houseNumbers is required — pick at least one');
  } else if (houseNumbersRaw.length > HOUSE_MAX) {
    errors.push(`houseNumbers may contain at most ${HOUSE_MAX} entries`);
  } else if (!houseNumbersRaw.every((n) => Number.isInteger(n) && n >= HOUSE_MIN && n <= HOUSE_MAX)) {
    errors.push(`every houseNumber must be an integer ${HOUSE_MIN}..${HOUSE_MAX}`);
  }
  if (!consent) errors.push('consent must be true — required by GDPR');

  if (errors.length) return json(400, { error: 'Validation failed', details: errors });

  const houseNumbers = Array.from(new Set(houseNumbersRaw as number[])).sort((a, b) => a - b);

  // Resolve person tags. Each entry is { slug } (already-known person) or
  // { proposedName } (new person to create as pending). Existing slugs must
  // already exist in DDB; proposals are upserted as pending if absent.
  const taggedPersonsInput = Array.isArray(body.taggedPersons) ? body.taggedPersons : [];
  if (taggedPersonsInput.length > 50) return json(400, { error: 'For many taggedPersons (max 50)' });
  const resolvedSlugs: string[] = [];
  const seen = new Set<string>();
  const proposerSub = typeof claims.sub === 'string' ? claims.sub : '';
  const proposerEmail = typeof claims.email === 'string' ? claims.email : '';
  const proposalAt = new Date().toISOString();
  for (const raw of taggedPersonsInput as Array<Record<string, unknown>>) {
    if (!raw || typeof raw !== 'object') continue;
    if (typeof raw.slug === 'string' && raw.slug.trim()) {
      const slug = raw.slug.trim();
      if (seen.has(slug)) continue;
      const exists = await ddb.send(
        new GetCommand({
          TableName: tableName,
          Key: { PK: PERSONLIST_PK, SK: `${PERSON_SK_PREFIX}${slug}` },
          ProjectionExpression: 'slug',
        }),
      );
      if (!exists.Item) return json(400, { error: `Ukendt person-slug: ${slug}` });
      seen.add(slug);
      resolvedSlugs.push(slug);
      continue;
    }
    if (typeof raw.proposedName === 'string' && raw.proposedName.trim()) {
      const displayName = normalizeDisplayName(raw.proposedName);
      const slug = slugify(displayName);
      if (!slug) continue;
      if (seen.has(slug)) continue;
      // Upsert as pending if not already present; keep existing if another
      // member already proposed it (idempotent).
      await ddb.send(
        new PutCommand({
          TableName: tableName,
          Item: {
            PK: PERSONLIST_PK,
            SK: `${PERSON_SK_PREFIX}${slug}`,
            entity: 'Person',
            slug,
            displayName,
            state: 'pending',
            proposedBy: proposerSub,
            proposedByEmail: proposerEmail,
            proposedAt: proposalAt,
          },
          ConditionExpression: 'attribute_not_exists(PK)',
        }),
      ).catch((err) => {
        if (err.name !== 'ConditionalCheckFailedException') throw err;
      });
      seen.add(slug);
      resolvedSlugs.push(slug);
    }
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
        description,
        whoInPhoto: whoInPhoto ?? '',
        year,
        yearApprox,
        houseNumbers,
        consent: true,
        visibilityWeb: false,
        visibilityBook: false,
        helpWanted,
        taggedPersonSlugs: resolvedSlugs,
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
