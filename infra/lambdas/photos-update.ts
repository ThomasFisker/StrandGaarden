import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { normalizeDisplayName, PERSON_SK_PREFIX, PERSONLIST_PK, slugify } from './persons-shared';
import { isValidHouse, USER_SK, userPk, VALID_HOUSES } from './users-shared';

const region = process.env.AWS_REGION ?? 'eu-west-1';
const tableName = process.env.TABLE_NAME!;

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region }));

const DESCRIPTION_MAX = 2000;
const WHO_IN_PHOTO_MAX = 1000;
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

/**
 * Admin-only edit of the static fields on a photo: description, whoInPhoto,
 * year, yearApprox, houseNumbers, taggedPersons. visibilityWeb/visibilityBook
 * are handled by /photos/{id}/decision. helpWanted by /photos/{id}/help-wanted.
 *
 * Body matches the editable subset of UploadMetadata — all fields required
 * in the request so the caller always sends a full snapshot.
 */
export const handler = async (event: APIGatewayProxyEventV2WithJWTAuthorizer) => {
  const claims = event.requestContext.authorizer?.jwt?.claims ?? {};
  const groups = parseGroups(claims['cognito:groups']);
  if (!groups.includes('admin')) return json(403, { error: 'Redigering er kun for administratorer' });

  const photoId = event.pathParameters?.id;
  if (!photoId || !/^[0-9a-f-]{36}$/.test(photoId)) return json(400, { error: 'Ugyldigt billede-id' });

  let body: Record<string, unknown>;
  try {
    body = JSON.parse(event.body ?? '{}');
  } catch {
    return json(400, { error: 'Request body must be valid JSON' });
  }

  const errors: string[] = [];
  const description = typeof body.description === 'string' ? body.description.trim() : '';
  const whoInPhoto = typeof body.whoInPhoto === 'string' ? body.whoInPhoto.trim() : '';
  const yearRaw = body.year;
  const year = yearRaw === null || yearRaw === undefined || yearRaw === '' ? null : Number(yearRaw);
  const yearApprox = body.yearApprox === true;
  const houseNumbersRaw = body.houseNumbers;
  const currentYear = new Date().getFullYear();

  if (!description) errors.push('description is required');
  else if (description.length > DESCRIPTION_MAX) errors.push(`description max ${DESCRIPTION_MAX} chars`);
  if (whoInPhoto.length > WHO_IN_PHOTO_MAX) errors.push(`whoInPhoto max ${WHO_IN_PHOTO_MAX} chars`);
  if (year !== null) {
    if (!Number.isInteger(year) || year < YEAR_MIN || year > currentYear) {
      errors.push(`year must be an integer between ${YEAR_MIN} and ${currentYear}`);
    }
  }
  if (!Array.isArray(houseNumbersRaw) || houseNumbersRaw.length === 0) {
    errors.push('houseNumbers is required — pick at least one');
  } else if (houseNumbersRaw.length > VALID_HOUSES.length) {
    errors.push(`houseNumbers may contain at most ${VALID_HOUSES.length} entries`);
  } else if (!houseNumbersRaw.every((n) => isValidHouse(n))) {
    errors.push('every houseNumber must be a valid Strandgaarden house number');
  }
  if (errors.length) return json(400, { error: 'Validation failed', details: errors });

  const houseNumbers = Array.from(new Set(houseNumbersRaw as number[])).sort((a, b) => a - b);

  // Confirm the photo exists before doing person work.
  const existing = await ddb.send(
    new GetCommand({ TableName: tableName, Key: { PK: `PHOTO#${photoId}`, SK: 'META' } }),
  );
  if (!existing.Item) return json(404, { error: 'Billedet findes ikke' });

  // Resolve person tags — same flow as upload-url: existing slugs must
  // exist; proposedName entries are upserted as pending.
  const taggedPersonsInput = Array.isArray(body.taggedPersons) ? body.taggedPersons : [];
  if (taggedPersonsInput.length > 50) return json(400, { error: 'For mange taggedPersons (max 50)' });
  const resolvedSlugs: string[] = [];
  const seen = new Set<string>();
  const editorSub = typeof claims.sub === 'string' ? claims.sub : '';
  const editorEmail = typeof claims.email === 'string' ? claims.email : '';
  const now = new Date().toISOString();
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
      await ddb
        .send(
          new PutCommand({
            TableName: tableName,
            Item: {
              PK: PERSONLIST_PK,
              SK: `${PERSON_SK_PREFIX}${slug}`,
              entity: 'Person',
              slug,
              displayName,
              state: 'pending',
              proposedBy: editorSub,
              proposedByEmail: editorEmail,
              proposedAt: now,
            },
            ConditionExpression: 'attribute_not_exists(PK)',
          }),
        )
        .catch((err) => {
          if (err.name !== 'ConditionalCheckFailedException') throw err;
        });
      seen.add(slug);
      resolvedSlugs.push(slug);
    }
  }

  // Snapshot old values for the audit row so we can see what changed later.
  const oldHouseNumbers = Array.isArray(existing.Item.houseNumbers)
    ? existing.Item.houseNumbers.map(Number)
    : [];
  const oldPriority =
    typeof existing.Item.priority === 'number' ? (existing.Item.priority as number) : null;
  const before = {
    description: String(existing.Item.description ?? ''),
    whoInPhoto: String(existing.Item.whoInPhoto ?? ''),
    year: existing.Item.year === null || existing.Item.year === undefined ? null : Number(existing.Item.year),
    yearApprox: existing.Item.yearApprox === true,
    houseNumbers: oldHouseNumbers,
    taggedPersonSlugs: Array.isArray(existing.Item.taggedPersonSlugs)
      ? (existing.Item.taggedPersonSlugs as string[])
      : [],
    priority: oldPriority,
  };

  // Priority field follows the photo's relationship to its uploader's
  // own house. If the admin removes the uploader's house from the
  // photo's tags, the priority is cleared (it's no longer ranked
  // against that user's house contributions). If the uploader's house
  // stays, priority is preserved. Admin can NOT set priority directly —
  // it's a member-only concept.
  let nextPriority: number | null = oldPriority;
  if (oldPriority !== null) {
    const uploaderSub =
      typeof existing.Item.uploaderSub === 'string' ? (existing.Item.uploaderSub as string) : '';
    if (uploaderSub) {
      const u = await ddb.send(
        new GetCommand({ TableName: tableName, Key: { PK: userPk(uploaderSub), SK: USER_SK } }),
      );
      const uploaderHouse =
        u.Item && typeof u.Item.houseNumber === 'number' ? (u.Item.houseNumber as number) : null;
      if (uploaderHouse === null || !houseNumbers.includes(uploaderHouse)) {
        nextPriority = null;
      }
    }
  }

  const baseUpdate =
    'SET description = :d, whoInPhoto = :w, #y = :y, yearApprox = :ya, houseNumbers = :h, ' +
    'taggedPersonSlugs = :tps, lastEditedAt = :at, lastEditedBy = :by';
  // REMOVE priority cleanly when it's being cleared so it's gone from
  // DDB instead of stored as null (matches the upload-url shape that
  // omits the field when there's no priority).
  const priorityClause =
    oldPriority !== null && nextPriority === null ? ' REMOVE priority' : '';

  await ddb.send(
    new UpdateCommand({
      TableName: tableName,
      Key: { PK: `PHOTO#${photoId}`, SK: 'META' },
      UpdateExpression: baseUpdate + priorityClause,
      ExpressionAttributeNames: { '#y': 'year' },
      ExpressionAttributeValues: {
        ':d': description,
        ':w': whoInPhoto,
        ':y': year,
        ':ya': yearApprox,
        ':h': houseNumbers,
        ':tps': resolvedSlugs,
        ':at': now,
        ':by': editorEmail || editorSub,
      },
    }),
  );

  await ddb.send(
    new PutCommand({
      TableName: tableName,
      Item: {
        PK: `PHOTO#${photoId}`,
        SK: `AUDIT#${now}#edited`,
        entity: 'Audit',
        event: 'Edited',
        at: now,
        by: editorEmail || editorSub,
        details: {
          before,
          after: {
            description,
            whoInPhoto,
            year,
            yearApprox,
            houseNumbers,
            taggedPersonSlugs: resolvedSlugs,
            priority: nextPriority,
          },
        },
      },
    }),
  );

  return json(200, { photoId, updatedAt: now });
};
