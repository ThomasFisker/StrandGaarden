import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';
import { DynamoDBClient, ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { canManageDocs } from './permissions';
import {
  DOC_NOTE_MAX,
  DOC_TAG_MAX,
  DOC_TAGS_MAX_COUNT,
  DOC_TITLE_MAX,
  docPk,
  isPositiveInt,
  META_SK,
  meetingPk,
} from './documents-shared';
import { loadDocCategoryNames } from './doc-categories-shared';

const region = process.env.AWS_REGION ?? 'eu-west-1';
const tableName = process.env.TABLE_NAME!;
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region }));

const json = (statusCode: number, body: unknown) => ({
  statusCode,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

const CURRENT_YEAR = new Date().getUTCFullYear();
const YEAR_MIN = 1900;

/** Edit a document's metadata (title, meetingId, category, year, tags, note).
 * The file itself can't be changed — replacing it means uploading a
 * new document and deleting the old one. */
export const handler = async (event: APIGatewayProxyEventV2WithJWTAuthorizer) => {
  const claims = event.requestContext.authorizer?.jwt?.claims;
  if (!claims) return json(401, { error: 'Unauthorized' });
  if (!canManageDocs(event)) return json(403, { error: 'Forbidden' });

  const docId = event.pathParameters?.id ?? '';
  if (!docId) return json(400, { error: 'Missing doc id' });

  let body: Record<string, unknown> = {};
  try {
    body = event.body ? JSON.parse(event.body) : {};
  } catch {
    return json(400, { error: 'Invalid JSON body' });
  }

  const title = typeof body.title === 'string' ? body.title.trim() : '';
  const category = body.category;
  const year = body.year;
  const meetingId = body.meetingId === null ? null : typeof body.meetingId === 'string' ? body.meetingId : undefined;
  const note = typeof body.note === 'string' ? body.note.trim() : '';
  const tagsRaw = Array.isArray(body.tags) ? body.tags : [];

  const errors: string[] = [];
  if (!title) errors.push('title required');
  if (title.length > DOC_TITLE_MAX) errors.push(`title max ${DOC_TITLE_MAX} chars`);
  if (typeof category !== 'string' || !category) {
    errors.push('category required');
  } else {
    const validCategoryNames = await loadDocCategoryNames(ddb, tableName);
    if (!validCategoryNames.has(category))
      errors.push('category must be one of the registered values');
  }
  if (!isPositiveInt(year) || (year as number) < YEAR_MIN || (year as number) > CURRENT_YEAR + 1)
    errors.push(`year must be a positive integer between ${YEAR_MIN} and ${CURRENT_YEAR + 1}`);
  if (note.length > DOC_NOTE_MAX) errors.push(`note max ${DOC_NOTE_MAX} chars`);
  if (meetingId === undefined) errors.push('meetingId required (use null to detach)');

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

  // Verify meeting exists if linking.
  if (meetingId !== null && meetingId !== undefined) {
    const m = await ddb.send(
      new GetCommand({ TableName: tableName, Key: { PK: meetingPk(meetingId), SK: META_SK } }),
    );
    if (!m.Item) return json(400, { error: 'meetingId references unknown meeting' });
  }

  // Snapshot before for audit
  const before = await ddb.send(
    new GetCommand({ TableName: tableName, Key: { PK: docPk(docId), SK: META_SK } }),
  );
  if (!before.Item) return json(404, { error: 'Document not found' });

  const now = new Date().toISOString();
  const editor = typeof claims.email === 'string' ? claims.email : String(claims.sub ?? '');

  try {
    if (meetingId === null) {
      await ddb.send(
        new UpdateCommand({
          TableName: tableName,
          Key: { PK: docPk(docId), SK: META_SK },
          UpdateExpression:
            'SET title = :t, category = :c, #y = :y, tags = :tags, note = :n, ' +
            'lastEditedAt = :at, lastEditedBy = :by REMOVE meetingId',
          ConditionExpression: 'attribute_exists(PK)',
          ExpressionAttributeNames: { '#y': 'year' },
          ExpressionAttributeValues: {
            ':t': title,
            ':c': category,
            ':y': year,
            ':tags': tags,
            ':n': note || null,
            ':at': now,
            ':by': editor,
          },
        }),
      );
    } else {
      await ddb.send(
        new UpdateCommand({
          TableName: tableName,
          Key: { PK: docPk(docId), SK: META_SK },
          UpdateExpression:
            'SET title = :t, meetingId = :m, category = :c, #y = :y, tags = :tags, note = :n, ' +
            'lastEditedAt = :at, lastEditedBy = :by',
          ConditionExpression: 'attribute_exists(PK)',
          ExpressionAttributeNames: { '#y': 'year' },
          ExpressionAttributeValues: {
            ':t': title,
            ':m': meetingId,
            ':c': category,
            ':y': year,
            ':tags': tags,
            ':n': note || null,
            ':at': now,
            ':by': editor,
          },
        }),
      );
    }
  } catch (err) {
    if (err instanceof ConditionalCheckFailedException) return json(404, { error: 'Document not found' });
    throw err;
  }

  await ddb.send(
    new PutCommand({
      TableName: tableName,
      Item: {
        PK: docPk(docId),
        SK: `AUDIT#${now}#edited`,
        entity: 'Audit',
        event: 'Edited',
        at: now,
        by: editor,
        details: {
          before: {
            title: String(before.Item.title ?? ''),
            meetingId: typeof before.Item.meetingId === 'string' ? before.Item.meetingId : null,
            category: String(before.Item.category ?? ''),
            year: typeof before.Item.year === 'number' ? before.Item.year : null,
            tags: Array.isArray(before.Item.tags) ? (before.Item.tags as unknown[]).map(String) : [],
            note: typeof before.Item.note === 'string' ? before.Item.note : null,
          },
          after: { title, meetingId, category, year, tags, note: note || null },
        },
      },
    }),
  );

  return json(200, { docId, updatedAt: now });
};
