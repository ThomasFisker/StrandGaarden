import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  BatchWriteCommand,
  DeleteCommand,
  GetCommand,
  PutCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';
import { DeleteObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { canManageDocs } from './permissions';
import { docPk, META_SK } from './documents-shared';

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

/**
 * Hard-delete a document: removes the S3 object, all DDB rows under
 * the doc's partition (META + AUDIT), and writes a top-level AUDIT row
 * so GDPR-scope deletes remain discoverable.
 */
export const handler = async (event: APIGatewayProxyEventV2WithJWTAuthorizer) => {
  const claims = event.requestContext.authorizer?.jwt?.claims;
  if (!claims) return json(401, { error: 'Unauthorized' });
  if (!canManageDocs(event)) return json(403, { error: 'Forbidden' });

  const docId = event.pathParameters?.id ?? '';
  if (!docId) return json(400, { error: 'Missing doc id' });

  const meta = await ddb.send(
    new GetCommand({ TableName: tableName, Key: { PK: docPk(docId), SK: META_SK } }),
  );
  if (!meta.Item) return json(404, { error: 'Document not found' });

  const s3Key = typeof meta.Item.s3Key === 'string' ? meta.Item.s3Key : null;
  const title = String(meta.Item.title ?? '');
  const originalFilename = String(meta.Item.originalFilename ?? '');
  const now = new Date().toISOString();
  const actor = typeof claims.email === 'string' ? claims.email : String(claims.sub ?? '');

  // Delete S3 object (best effort — if it fails we still scrub DDB so
  // the doc disappears from the UI; orphaned S3 objects are reclaimable
  // via lifecycle if it ever becomes an issue).
  if (s3Key) {
    try {
      await s3.send(new DeleteObjectCommand({ Bucket: originalsBucket, Key: s3Key }));
    } catch {
      // Swallow — proceed to DDB cleanup.
    }
  }

  // Collect every row under this doc's partition (META + AUDIT*) and
  // delete in batches of 25.
  const partitionRows: { PK: string; SK: string }[] = [];
  let ExclusiveStartKey: Record<string, unknown> | undefined;
  do {
    const r = await ddb.send(
      new QueryCommand({
        TableName: tableName,
        KeyConditionExpression: 'PK = :pk',
        ExpressionAttributeValues: { ':pk': docPk(docId) },
        ProjectionExpression: 'PK, SK',
        ExclusiveStartKey,
      }),
    );
    for (const it of r.Items ?? []) {
      partitionRows.push({ PK: String(it.PK), SK: String(it.SK) });
    }
    ExclusiveStartKey = r.LastEvaluatedKey;
  } while (ExclusiveStartKey);

  for (let i = 0; i < partitionRows.length; i += 25) {
    const batch = partitionRows.slice(i, i + 25);
    await ddb.send(
      new BatchWriteCommand({
        RequestItems: {
          [tableName]: batch.map((k) => ({ DeleteRequest: { Key: k } })),
        },
      }),
    );
  }

  // Defensive: ensure META is gone even if the BatchWrite call had
  // partial UnprocessedItems we didn't retry.
  await ddb.send(new DeleteCommand({ TableName: tableName, Key: { PK: docPk(docId), SK: META_SK } }));

  // Top-level AUDIT row — survives the doc-partition scrub and keeps
  // GDPR-scope deletions discoverable from a single PK=AUDIT query.
  await ddb.send(
    new PutCommand({
      TableName: tableName,
      Item: {
        PK: 'AUDIT',
        SK: `DOC#${docId}#${now}`,
        entity: 'Audit',
        event: 'DocumentDeleted',
        at: now,
        by: actor,
        details: { docId, title, originalFilename, s3Key },
      },
    }),
  );

  return json(200, { docId, deleted: true });
};
