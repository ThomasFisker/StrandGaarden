import { randomUUID } from 'node:crypto';
import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { ACTIVITY_SK_PREFIX, ACTIVITYLIST_PK } from './activities-shared';
import { FREEZE_ERROR_MESSAGE, getConfig, isFrozenForCaller } from './config-shared';
import { normalizeDisplayName, PERSON_SK_PREFIX, PERSONLIST_PK, slugify } from './persons-shared';
import { USER_SK, userPk } from './users-shared';
import { ScanCommand } from '@aws-sdk/lib-dynamodb';

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

/** Count of PHOTO rows whose houseNumbers list contains the given house.
 * Used by the Stage-1 per-house cap check. Pre-Rejected photos are not
 * filtered out — once an admin sets status=Rejected they typically also
 * delete the row, so they don't accumulate against the cap in practice. */
const countPhotosForHouse = async (house: number): Promise<number> => {
  let count = 0;
  let ExclusiveStartKey: Record<string, unknown> | undefined;
  do {
    const r = await ddb.send(
      new ScanCommand({
        TableName: tableName,
        FilterExpression: 'entity = :p AND contains(houseNumbers, :h)',
        ExpressionAttributeValues: { ':p': 'Photo', ':h': house },
        ProjectionExpression: 'photoId',
        ExclusiveStartKey,
      }),
    );
    count += r.Items?.length ?? 0;
    ExclusiveStartKey = r.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return count;
};

export const handler = async (event: APIGatewayProxyEventV2WithJWTAuthorizer) => {
  const claims = event.requestContext.authorizer?.jwt?.claims ?? {};
  const groups = parseGroups(claims['cognito:groups']);
  if (!groups.some((g) => g === 'admin' || g === 'member')) {
    return json(403, { error: 'Upload is restricted to admin and member roles' });
  }

  const isAdminCaller = groups.includes('admin');
  const cfg = await getConfig(ddb, tableName);
  if (isFrozenForCaller(cfg, isAdminCaller)) {
    return json(423, { error: FREEZE_ERROR_MESSAGE });
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
  const activityKeyRaw = body.activityKey;
  const activityKey =
    typeof activityKeyRaw === 'string' && activityKeyRaw.trim() ? activityKeyRaw.trim() : null;
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
  if (!consent) errors.push('consent must be true — required by GDPR');

  // Stage-1 routing for non-admins: choose either own-house (locked +
  // capped) or an activity. Admins keep stage-3 free-form behavior.
  const stageOneNonAdmin = cfg.stage === 1 && !isAdminCaller;
  let houseNumbers: number[] = [];
  let resolvedActivityKey: string | null = null;

  if (stageOneNonAdmin) {
    const callerSub = typeof claims.sub === 'string' ? claims.sub : '';
    const userRow = await ddb.send(
      new GetCommand({ TableName: tableName, Key: { PK: userPk(callerSub), SK: USER_SK } }),
    );
    const myHouse =
      userRow.Item && typeof userRow.Item.houseNumber === 'number'
        ? (userRow.Item.houseNumber as number)
        : null;

    if (activityKey) {
      const ar = await ddb.send(
        new GetCommand({
          TableName: tableName,
          Key: { PK: ACTIVITYLIST_PK, SK: `${ACTIVITY_SK_PREFIX}${activityKey}` },
          ProjectionExpression: 'displayName',
        }),
      );
      if (!ar.Item) errors.push(`Ukendt aktivitet: ${activityKey}`);
      else resolvedActivityKey = activityKey;
      if (Array.isArray(houseNumbersRaw) && houseNumbersRaw.length > 0) {
        errors.push('I fase 1: vælg enten et hus eller en aktivitet — ikke begge.');
      }
    } else {
      if (myHouse === null) {
        errors.push(
          'Du er ikke tildelt et hus. Bed udvalget om at tildele dig et hus, eller vælg en aktivitet.',
        );
      } else if (
        !Array.isArray(houseNumbersRaw) ||
        houseNumbersRaw.length !== 1 ||
        Number(houseNumbersRaw[0]) !== myHouse
      ) {
        errors.push(`I fase 1 kan du kun uploade til dit eget hus (Hus ${myHouse}).`);
      } else {
        houseNumbers = [myHouse];
      }
    }
  } else {
    if (!Array.isArray(houseNumbersRaw) || houseNumbersRaw.length === 0) {
      errors.push('houseNumbers is required — pick at least one');
    } else if (houseNumbersRaw.length > HOUSE_MAX) {
      errors.push(`houseNumbers may contain at most ${HOUSE_MAX} entries`);
    } else if (!houseNumbersRaw.every((n) => Number.isInteger(n) && n >= HOUSE_MIN && n <= HOUSE_MAX)) {
      errors.push(`every houseNumber must be an integer ${HOUSE_MIN}..${HOUSE_MAX}`);
    } else {
      houseNumbers = Array.from(new Set(houseNumbersRaw as number[])).sort((a, b) => a - b);
    }
    if (activityKey) {
      // Activities outside Stage 1 are simply ignored to keep the schema
      // forward-compatible — the form there doesn't surface them.
      resolvedActivityKey = null;
    }
  }

  if (errors.length) return json(400, { error: 'Validation failed', details: errors });

  // Stage-1 per-house cap: count existing photos tagged with this house and
  // reject if at the configured limit. Skipped on the activity branch — the
  // book has a separate (per-activity) section there.
  if (stageOneNonAdmin && houseNumbers.length === 1) {
    const used = await countPhotosForHouse(houseNumbers[0]);
    if (used >= cfg.maxBookSlotsPerHouse) {
      return json(409, {
        error: `Hus ${houseNumbers[0]} har allerede ${used} af ${cfg.maxBookSlotsPerHouse} mulige billeder. Bed udvalget om at fjerne et først, hvis du vil uploade flere.`,
      });
    }
  }

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

  // Atomic increment of the photo counter — concurrent uploads each get a
  // unique sequential short ID. Formatted as ID-00042 for human reference.
  const counter = await ddb.send(
    new UpdateCommand({
      TableName: tableName,
      Key: { PK: 'COUNTER#PHOTOID', SK: 'META' },
      UpdateExpression: 'ADD nextId :one',
      ExpressionAttributeValues: { ':one': 1 },
      ReturnValues: 'UPDATED_NEW',
    }),
  );
  const shortId = Number(counter.Attributes?.nextId ?? 0);

  await ddb.send(
    new PutCommand({
      TableName: tableName,
      Item: {
        PK: `PHOTO#${photoId}`,
        SK: 'META',
        entity: 'Photo',
        status: 'Uploaded',
        photoId,
        shortId,
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
        ...(resolvedActivityKey ? { activityKey: resolvedActivityKey } : {}),
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
