import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  DeleteCommand,
  GetCommand,
  PutCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';
import { DeleteObjectCommand, NoSuchKey, S3Client, S3ServiceException } from '@aws-sdk/client-s3';
import { FREEZE_ERROR_MESSAGE, getConfig, isFrozenForCaller } from './config-shared';

const region = process.env.AWS_REGION ?? 'eu-west-1';
const tableName = process.env.TABLE_NAME!;
const originalsBucket = process.env.ORIGINALS_BUCKET!;
const derivedBucket = process.env.DERIVED_BUCKET!;

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region }));
const s3 = new S3Client({ region });

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
 * Delete a photo (S3 originals + derived + every DDB row in its
 * partition), then leave a small TOMBSTONE row + a top-level AUDIT row
 * so the deletion stays discoverable.
 *
 * Authorization is stage-aware:
 * - Admins (udvalget) may delete in any stage.
 * - Non-admin members may delete **their own** photo only in stage 1
 *   (Indsamling). In stage 2 (Frys) all non-admin writes are locked
 *   (423). In stage 3 (Offentlig) members must instead use the removal
 *   request flow (POST /photos/{id}/removals), so a direct delete is
 *   refused with a pointer to that flow.
 */
export const handler = async (event: APIGatewayProxyEventV2WithJWTAuthorizer) => {
  const claims = event.requestContext.authorizer?.jwt?.claims ?? {};
  const groups = parseGroups(claims['cognito:groups']);
  const isAdminCaller = groups.includes('admin');
  const callerSub = typeof claims.sub === 'string' ? claims.sub : '';
  const callerEmail = typeof claims.email === 'string' ? claims.email : '';

  const photoId = event.pathParameters?.id;
  if (!photoId || !/^[0-9a-f-]{36}$/.test(photoId)) return json(400, { error: 'Ugyldigt billede-id' });

  const meta = await ddb.send(
    new GetCommand({ TableName: tableName, Key: { PK: `PHOTO#${photoId}`, SK: 'META' } }),
  );
  if (!meta.Item) return json(404, { error: 'Billedet findes ikke' });

  const uploaderSub = typeof meta.Item.uploaderSub === 'string' ? meta.Item.uploaderSub : null;

  // Non-admin authorization: ownership + stage gating.
  if (!isAdminCaller) {
    const cfg = await getConfig(ddb, tableName);
    if (isFrozenForCaller(cfg, isAdminCaller)) {
      return json(423, { error: FREEZE_ERROR_MESSAGE });
    }
    if (cfg.stage === 3) {
      return json(403, {
        error:
          'I denne fase skal du bede udvalget om at fjerne billedet via "Anmod om fjernelse".',
      });
    }
    // Stage 1 (Indsamling): own photos only.
    if (!callerSub || uploaderSub !== callerSub) {
      return json(403, { error: 'Du kan kun slette dine egne billeder' });
    }
  }

  const originalKey = typeof meta.Item.s3Key === 'string' ? meta.Item.s3Key : undefined;
  const webKey = typeof meta.Item.derivedWebKey === 'string' ? meta.Item.derivedWebKey : undefined;
  const thumbKey = typeof meta.Item.derivedThumbKey === 'string' ? meta.Item.derivedThumbKey : undefined;
  const bookKey = typeof meta.Item.derivedBookKey === 'string' ? meta.Item.derivedBookKey : undefined;

  const shortId = typeof meta.Item.shortId === 'number' ? meta.Item.shortId : null;
  const description = typeof meta.Item.description === 'string' ? meta.Item.description : '';
  const deletedAt = new Date().toISOString();
  const deletedByRole = isAdminCaller ? 'admin' : 'member';

  await Promise.all([
    deleteS3Best(originalsBucket, originalKey),
    deleteS3Best(derivedBucket, webKey),
    deleteS3Best(derivedBucket, thumbKey),
    deleteS3Best(derivedBucket, bookKey),
  ]);

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

  // Tombstone — written AFTER the partition scrub so it survives. Records
  // that this photo ID once held a picture that was deleted, and by whom.
  await ddb.send(
    new PutCommand({
      TableName: tableName,
      Item: {
        PK: `PHOTO#${photoId}`,
        SK: 'TOMBSTONE',
        entity: 'Tombstone',
        photoId,
        shortId,
        deletedAt,
        deletedBy: callerEmail || callerSub,
        deletedBySub: callerSub,
        deletedByRole,
        originalUploaderSub: uploaderSub,
      },
    }),
  );

  // Top-level AUDIT row — survives the partition scrub and keeps deletions
  // discoverable from a single PK=AUDIT query.
  await ddb.send(
    new PutCommand({
      TableName: tableName,
      Item: {
        PK: 'AUDIT',
        SK: `${deletedAt}#photo-deleted#${photoId}`,
        entity: 'Audit',
        event: deletedByRole === 'admin' ? 'PhotoDeletedByAdmin' : 'PhotoDeletedByUser',
        at: deletedAt,
        by: callerEmail || callerSub,
        photoId,
        shortId,
        originalUploaderSub: uploaderSub,
        originalDescription: description,
      },
    }),
  );

  return json(200, { photoId, deleted: true });
};
