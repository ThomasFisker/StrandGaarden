import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  DeleteCommand,
  GetCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';
import { DeleteObjectCommand, NoSuchKey, S3Client, S3ServiceException } from '@aws-sdk/client-s3';

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

export const handler = async (event: APIGatewayProxyEventV2WithJWTAuthorizer) => {
  const claims = event.requestContext.authorizer?.jwt?.claims ?? {};
  const groups = parseGroups(claims['cognito:groups']);
  if (!groups.includes('admin')) return json(403, { error: 'Sletning er kun for administratorer' });

  const photoId = event.pathParameters?.id;
  if (!photoId || !/^[0-9a-f-]{36}$/.test(photoId)) return json(400, { error: 'Ugyldigt billede-id' });

  const meta = await ddb.send(
    new GetCommand({ TableName: tableName, Key: { PK: `PHOTO#${photoId}`, SK: 'META' } }),
  );
  if (!meta.Item) return json(404, { error: 'Billedet findes ikke' });

  const originalKey = typeof meta.Item.s3Key === 'string' ? meta.Item.s3Key : undefined;
  const webKey = typeof meta.Item.derivedWebKey === 'string' ? meta.Item.derivedWebKey : undefined;
  const thumbKey = typeof meta.Item.derivedThumbKey === 'string' ? meta.Item.derivedThumbKey : undefined;
  const bookKey = typeof meta.Item.derivedBookKey === 'string' ? meta.Item.derivedBookKey : undefined;

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

  return json(200, { photoId, deleted: true });
};
