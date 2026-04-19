import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const region = process.env.AWS_REGION ?? 'eu-west-1';
const tableName = process.env.TABLE_NAME!;
const derivedBucket = process.env.DERIVED_BUCKET!;
const URL_TTL = 900;

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region }));
const s3 = new S3Client({ region });

const json = (statusCode: number, body: unknown) => ({
  statusCode,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

const safeFilename = (input: string): string => {
  const noPath = input.replace(/[\\/]/g, '_');
  return noPath.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 120) || 'strandgaarden.jpg';
};

export const handler = async (event: APIGatewayProxyEventV2WithJWTAuthorizer) => {
  const photoId = event.pathParameters?.id;
  if (!photoId || !/^[0-9a-f-]{36}$/.test(photoId)) {
    return json(400, { error: 'Invalid photo id' });
  }

  const r = await ddb.send(
    new GetCommand({ TableName: tableName, Key: { PK: `PHOTO#${photoId}`, SK: 'META' } }),
  );
  const item = r.Item;
  // Hide unpublished photos behind a 404 so IDs can't be probed.
  if (!item || item.status !== 'Decided' || item.visibilityWeb !== true) {
    return json(404, { error: 'Billedet findes ikke' });
  }

  const webKey = typeof item.derivedWebKey === 'string' ? item.derivedWebKey : null;
  const thumbKey = typeof item.derivedThumbKey === 'string' ? item.derivedThumbKey : null;
  const originalFilename = typeof item.originalFilename === 'string' ? item.originalFilename : 'strandgaarden.jpg';
  const downloadName = `strandgaarden-${photoId.slice(0, 8)}-${safeFilename(originalFilename.replace(/\.[^.]+$/, ''))}.jpg`;

  const [webUrl, thumbnailUrl, downloadUrl] = await Promise.all([
    webKey
      ? getSignedUrl(s3, new GetObjectCommand({ Bucket: derivedBucket, Key: webKey }), { expiresIn: URL_TTL })
      : Promise.resolve(null as string | null),
    thumbKey
      ? getSignedUrl(s3, new GetObjectCommand({ Bucket: derivedBucket, Key: thumbKey }), { expiresIn: URL_TTL })
      : Promise.resolve(null as string | null),
    webKey
      ? getSignedUrl(
          s3,
          new GetObjectCommand({
            Bucket: derivedBucket,
            Key: webKey,
            ResponseContentDisposition: `attachment; filename="${downloadName}"`,
          }),
          { expiresIn: URL_TTL },
        )
      : Promise.resolve(null as string | null),
  ]);

  return json(200, {
    photoId: String(item.photoId),
    description: String(item.description ?? ''),
    whoInPhoto: String(item.whoInPhoto ?? ''),
    year: item.year === null || item.year === undefined ? null : Number(item.year),
    yearApprox: item.yearApprox === true,
    houseNumbers: Array.isArray(item.houseNumbers) ? item.houseNumbers.map(Number) : [],
    width: item.width === null || item.width === undefined ? null : Number(item.width),
    height: item.height === null || item.height === undefined ? null : Number(item.height),
    blurhash: typeof item.blurhash === 'string' ? item.blurhash : null,
    visibilityBook: item.visibilityBook === true,
    webUrl,
    thumbnailUrl,
    downloadUrl,
  });
};
