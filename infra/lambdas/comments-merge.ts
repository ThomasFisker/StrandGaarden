import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';
import { ConditionalCheckFailedException, DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { normalizeDisplayName, PERSON_SK_PREFIX, PERSONLIST_PK, slugify } from './persons-shared';

const region = process.env.AWS_REGION ?? 'eu-west-1';
const tableName = process.env.TABLE_NAME!;

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region }));

const DESCRIPTION_MAX = 2000;

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
 * Admin merges a pending comment. The admin edits description + person tags
 * in the UI; we apply the edits to the photo, then stamp the comment as
 * either `merged` (fully absorbed into description) or `shown` (kept as an
 * attributed addendum visible on the gallery detail page).
 *
 * Body shape:
 *   {
 *     description: string,
 *     taggedPersons: Array<{ slug: string } | { proposedName: string }>,
 *     keepAsAddendum?: boolean
 *   }
 */
export const handler = async (event: APIGatewayProxyEventV2WithJWTAuthorizer) => {
  const claims = event.requestContext.authorizer?.jwt?.claims ?? {};
  const groups = parseGroups(claims['cognito:groups']);
  if (!groups.includes('admin')) return json(403, { error: 'Admin only' });

  const photoId = event.pathParameters?.photoId;
  const commentId = event.pathParameters?.commentId;
  if (!photoId || !/^[0-9a-f-]{36}$/.test(photoId)) return json(400, { error: 'Ugyldigt billede-id' });
  if (!commentId || !/^[0-9a-f-]{36}$/.test(commentId)) return json(400, { error: 'Ugyldig kommentar-id' });

  let reqBody: Record<string, unknown>;
  try {
    reqBody = JSON.parse(event.body ?? '{}');
  } catch {
    return json(400, { error: 'Request body must be valid JSON' });
  }

  const description = typeof reqBody.description === 'string' ? reqBody.description.trim() : null;
  if (description === null) return json(400, { error: 'description is required' });
  if (!description) return json(400, { error: 'Beskrivelsen må ikke være tom' });
  if (description.length > DESCRIPTION_MAX) return json(400, { error: `description max ${DESCRIPTION_MAX} chars` });

  const taggedPersonsInput = Array.isArray(reqBody.taggedPersons) ? reqBody.taggedPersons : [];
  if (taggedPersonsInput.length > 50) return json(400, { error: 'For many taggedPersons (max 50)' });

  const keepAsAddendum = reqBody.keepAsAddendum === true;

  const decidedAt = new Date().toISOString();
  const decidedBy = typeof claims.email === 'string' ? claims.email : String(claims.sub ?? 'unknown');
  const proposerSub = typeof claims.sub === 'string' ? claims.sub : '';
  const proposerEmail = typeof claims.email === 'string' ? claims.email : '';

  // Resolve tagged persons — existing slugs must already exist; proposals are
  // upserted as pending. Mirrors the logic in upload-url so admins can add
  // brand-new names while merging.
  const resolvedSlugs: string[] = [];
  const seen = new Set<string>();
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
              proposedBy: proposerSub,
              proposedByEmail: proposerEmail,
              proposedAt: decidedAt,
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

  // Locate the COMMENT row — we only know commentId (SK ends with `#${commentId}`).
  // A Query on PK=PHOTO#<id> begins_with(SK, 'COMMENT#') is cheap (bounded by comments on this photo).
  const scan = await ddb.send(
    new QueryCommand({
      TableName: tableName,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      ExpressionAttributeValues: { ':pk': `PHOTO#${photoId}`, ':sk': 'COMMENT#' },
    }),
  );
  const match = (scan.Items ?? []).find((it) => String(it.commentId) === commentId);
  if (!match) return json(404, { error: 'Kommentaren findes ikke' });
  if (match.status !== 'pending') return json(409, { error: 'Kommentaren er allerede behandlet' });

  // Apply edits to the photo. Both description and taggedPersonSlugs always
  // replaced — the admin has already decided what they want stored.
  await ddb.send(
    new UpdateCommand({
      TableName: tableName,
      Key: { PK: `PHOTO#${photoId}`, SK: 'META' },
      ConditionExpression: 'attribute_exists(PK)',
      UpdateExpression: 'SET description = :d, taggedPersonSlugs = :t',
      ExpressionAttributeValues: { ':d': description, ':t': resolvedSlugs },
    }),
  );

  // Flip the comment's status + drop it from the pending-queue GSI partition.
  const nextStatus = keepAsAddendum ? 'shown' : 'merged';
  try {
    await ddb.send(
      new UpdateCommand({
        TableName: tableName,
        Key: { PK: match.PK, SK: match.SK },
        ConditionExpression: '#s = :pending',
        UpdateExpression:
          'SET #s = :next, decidedAt = :at, decidedBy = :by REMOVE GSI1PK, GSI1SK',
        ExpressionAttributeNames: { '#s': 'status' },
        ExpressionAttributeValues: {
          ':pending': 'pending',
          ':next': nextStatus,
          ':at': decidedAt,
          ':by': decidedBy,
        },
      }),
    );
  } catch (err) {
    if (err instanceof ConditionalCheckFailedException) {
      return json(409, { error: 'Kommentaren er allerede behandlet' });
    }
    throw err;
  }

  await ddb.send(
    new PutCommand({
      TableName: tableName,
      Item: {
        PK: `PHOTO#${photoId}`,
        SK: `AUDIT#${decidedAt}#comment-${nextStatus}`,
        entity: 'Audit',
        event: nextStatus === 'merged' ? 'CommentMerged' : 'CommentShown',
        at: decidedAt,
        by: decidedBy,
        details: { commentId, description, taggedPersonSlugs: resolvedSlugs },
      },
    }),
  );

  return json(200, { commentId, photoId, status: nextStatus, description, taggedPersonSlugs: resolvedSlugs });
};
