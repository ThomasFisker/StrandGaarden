import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';
import { ConditionalCheckFailedException, DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  DeleteCommand,
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { DeleteObjectCommand, NoSuchKey, S3Client, S3ServiceException } from '@aws-sdk/client-s3';

const region = process.env.AWS_REGION ?? 'eu-west-1';
const tableName = process.env.TABLE_NAME!;
const originalsBucket = process.env.ORIGINALS_BUCKET!;
const derivedBucket = process.env.DERIVED_BUCKET!;

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region }));
const s3 = new S3Client({ region });

const NOTE_MAX = 1000;

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

const deleteS3Best = async (Bucket: string, Key: string | undefined): Promise<void> => {
  if (!Key) return;
  try {
    await s3.send(new DeleteObjectCommand({ Bucket, Key }));
  } catch (err) {
    if (err instanceof NoSuchKey) return;
    if (err instanceof S3ServiceException && err.$metadata?.httpStatusCode === 404) return;
    throw err;
  }
};

/**
 * Admin decides a pending removal request.
 *
 * - When approved: writes a top-level AUDIT row (PK=AUDIT, survives the
 *   photo deletion), scrubs S3 original + derivatives, and deletes every
 *   DDB item under PHOTO#<id>.
 * - When rejected: stamps the removal row `rejected` + decision metadata,
 *   drops it from the pending GSI partition. Photo untouched.
 *
 * Body shape: { approved: boolean, note?: string }
 */
export const handler = async (event: APIGatewayProxyEventV2WithJWTAuthorizer) => {
  const claims = event.requestContext.authorizer?.jwt?.claims ?? {};
  const groups = parseGroups(claims['cognito:groups']);
  if (!groups.includes('admin')) return json(403, { error: 'Admin only' });

  const photoId = event.pathParameters?.photoId;
  const removalId = event.pathParameters?.removalId;
  if (!photoId || !/^[0-9a-f-]{36}$/.test(photoId)) return json(400, { error: 'Ugyldigt billede-id' });
  if (!removalId || !/^[0-9a-f-]{36}$/.test(removalId)) return json(400, { error: 'Ugyldig anmodning-id' });

  let reqBody: Record<string, unknown>;
  try {
    reqBody = JSON.parse(event.body ?? '{}');
  } catch {
    return json(400, { error: 'Request body must be valid JSON' });
  }
  if (typeof reqBody.approved !== 'boolean') return json(400, { error: 'approved (boolean) is required' });
  const approved = reqBody.approved;
  const note = typeof reqBody.note === 'string' ? reqBody.note.trim() : '';
  if (note.length > NOTE_MAX) return json(400, { error: `Note max ${NOTE_MAX} tegn` });

  // Find the removal row.
  const q = await ddb.send(
    new QueryCommand({
      TableName: tableName,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      ExpressionAttributeValues: { ':pk': `PHOTO#${photoId}`, ':sk': 'REMOVAL#' },
    }),
  );
  const removal = (q.Items ?? []).find((it) => String(it.removalId) === removalId);
  if (!removal) return json(404, { error: 'Anmodningen findes ikke' });
  if (removal.status !== 'pending') return json(409, { error: 'Anmodningen er allerede behandlet' });

  const decidedAt = new Date().toISOString();
  const decidedBy = typeof claims.email === 'string' ? claims.email : String(claims.sub ?? 'unknown');

  if (!approved) {
    // Reject — keep the removal row, flip status, strip the pending-queue GSI.
    try {
      await ddb.send(
        new UpdateCommand({
          TableName: tableName,
          Key: { PK: removal.PK, SK: removal.SK },
          ConditionExpression: '#s = :pending',
          UpdateExpression:
            'SET #s = :rejected, decidedAt = :at, decidedBy = :by, decisionNote = :n REMOVE GSI1PK, GSI1SK',
          ExpressionAttributeNames: { '#s': 'status' },
          ExpressionAttributeValues: {
            ':pending': 'pending',
            ':rejected': 'rejected',
            ':at': decidedAt,
            ':by': decidedBy,
            ':n': note,
          },
        }),
      );
    } catch (err) {
      if (err instanceof ConditionalCheckFailedException) {
        return json(409, { error: 'Anmodningen er allerede behandlet' });
      }
      throw err;
    }
    return json(200, { removalId, photoId, status: 'rejected' });
  }

  // Approve — load the photo row so we can snapshot it into the audit trail
  // BEFORE we delete everything under PHOTO#<id>.
  const photoGet = await ddb.send(
    new GetCommand({ TableName: tableName, Key: { PK: `PHOTO#${photoId}`, SK: 'META' } }),
  );
  if (!photoGet.Item) return json(404, { error: 'Billedet findes ikke længere' });
  const photo = photoGet.Item;

  await ddb.send(
    new PutCommand({
      TableName: tableName,
      Item: {
        PK: 'AUDIT',
        SK: `${decidedAt}#photo-removed#${photoId}`,
        entity: 'Audit',
        event: 'PhotoRemovedByCommittee',
        at: decidedAt,
        approvedBy: decidedBy,
        photoId,
        shortId: photo.shortId ?? null,
        originalDescription: photo.description ?? '',
        originalHouseNumbers: Array.isArray(photo.houseNumbers) ? photo.houseNumbers : [],
        originalYear: photo.year ?? null,
        originalUploaderSub: photo.uploaderSub ?? '',
        originalUploaderEmail: photo.uploaderEmail ?? '',
        requestorSub: removal.requestorSub ?? '',
        requestorLoginName: removal.requestorLoginName ?? '',
        requestorEmail: removal.requestorEmail ?? '',
        requestorRole: removal.requestorRole ?? '',
        reason: removal.reason ?? '',
        decisionNote: note,
      },
    }),
  );

  // S3 scrub — best-effort per key (tolerates missing derivatives).
  const originalKey = typeof photo.s3Key === 'string' ? photo.s3Key : undefined;
  const webKey = typeof photo.derivedWebKey === 'string' ? photo.derivedWebKey : undefined;
  const thumbKey = typeof photo.derivedThumbKey === 'string' ? photo.derivedThumbKey : undefined;
  const bookKey = typeof photo.derivedBookKey === 'string' ? photo.derivedBookKey : undefined;
  await Promise.all([
    deleteS3Best(originalsBucket, originalKey),
    deleteS3Best(derivedBucket, webKey),
    deleteS3Best(derivedBucket, thumbKey),
    deleteS3Best(derivedBucket, bookKey),
  ]);

  // DDB scrub — every item under PK=PHOTO#<id> (META + AUDIT + COMMENT + REMOVAL).
  let ExclusiveStartKey: Record<string, unknown> | undefined;
  do {
    const page = await ddb.send(
      new QueryCommand({
        TableName: tableName,
        KeyConditionExpression: 'PK = :pk',
        ExpressionAttributeValues: { ':pk': `PHOTO#${photoId}` },
        ProjectionExpression: 'PK, SK',
        ExclusiveStartKey,
      }),
    );
    for (const item of page.Items ?? []) {
      await ddb.send(
        new DeleteCommand({ TableName: tableName, Key: { PK: item.PK, SK: item.SK } }),
      );
    }
    ExclusiveStartKey = page.LastEvaluatedKey;
  } while (ExclusiveStartKey);

  return json(200, { removalId, photoId, status: 'approved', deleted: true });
};
