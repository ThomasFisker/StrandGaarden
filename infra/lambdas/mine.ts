import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { PERSON_SK_PREFIX, PERSONLIST_PK } from './persons-shared';

const region = process.env.AWS_REGION ?? 'eu-west-1';
const tableName = process.env.TABLE_NAME!;
const derivedBucket = process.env.DERIVED_BUCKET!;
const THUMB_URL_TTL = 300;

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region }));
const s3 = new S3Client({ region });

const json = (statusCode: number, body: unknown) => ({
  statusCode,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

interface PersonTag {
  slug: string;
  displayName: string;
  state: string;
}

interface PhotoRow {
  photoId: string;
  shortId: number | null;
  s3Key: string;
  status: string;
  createdAt: string;
  originalFilename: string;
  contentType: string;
  description: string;
  whoInPhoto: string;
  year: number | null;
  yearApprox: boolean;
  houseNumbers: number[];
  visibilityWeb: boolean;
  visibilityBook: boolean;
  width: number | null;
  height: number | null;
  blurhash: string | null;
  thumbnailUrl: string | null;
  processingError: string | null;
  persons: PersonTag[];
  helpWanted: boolean;
}

const loadPersonMap = async (): Promise<Map<string, PersonTag>> => {
  const map = new Map<string, PersonTag>();
  let ExclusiveStartKey: Record<string, unknown> | undefined;
  do {
    const r = await ddb.send(
      new QueryCommand({
        TableName: tableName,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
        ExpressionAttributeValues: { ':pk': PERSONLIST_PK, ':sk': PERSON_SK_PREFIX },
        ExclusiveStartKey,
      }),
    );
    for (const it of r.Items ?? []) {
      const slug = typeof it.slug === 'string' ? it.slug : '';
      if (!slug) continue;
      map.set(slug, {
        slug,
        displayName: String(it.displayName ?? slug),
        state: String(it.state ?? ''),
      });
    }
    ExclusiveStartKey = r.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return map;
};

export const handler = async (event: APIGatewayProxyEventV2WithJWTAuthorizer) => {
  const claims = event.requestContext.authorizer?.jwt?.claims ?? {};
  const sub = typeof claims.sub === 'string' ? claims.sub : null;
  if (!sub) return json(401, { error: 'Missing subject claim' });

  const personMap = await loadPersonMap();

  const rows: PhotoRow[] = [];
  let ExclusiveStartKey: Record<string, unknown> | undefined;
  do {
    const result = await ddb.send(
      new ScanCommand({
        TableName: tableName,
        FilterExpression: 'entity = :p AND uploaderSub = :u',
        ExpressionAttributeValues: { ':p': 'Photo', ':u': sub },
        ExclusiveStartKey,
      }),
    );
    for (const item of result.Items ?? []) {
      const derivedThumbKey = typeof item.derivedThumbKey === 'string' ? item.derivedThumbKey : null;
      const thumbnailUrl = derivedThumbKey
        ? await getSignedUrl(
            s3,
            new GetObjectCommand({ Bucket: derivedBucket, Key: derivedThumbKey }),
            { expiresIn: THUMB_URL_TTL },
          )
        : null;
      rows.push({
        photoId: String(item.photoId),
        shortId: item.shortId !== null && item.shortId !== undefined ? Number(item.shortId) : null,
        s3Key: String(item.s3Key),
        status: String(item.status),
        createdAt: String(item.createdAt),
        originalFilename: String(item.originalFilename ?? ''),
        contentType: String(item.contentType ?? ''),
        description: String(item.description ?? ''),
        whoInPhoto: String(item.whoInPhoto ?? ''),
        year: item.year === null || item.year === undefined ? null : Number(item.year),
        yearApprox: item.yearApprox === true,
        houseNumbers: Array.isArray(item.houseNumbers) ? item.houseNumbers.map(Number) : [],
        visibilityWeb: item.visibilityWeb === true,
        visibilityBook: item.visibilityBook === true,
        width: item.width === null || item.width === undefined ? null : Number(item.width),
        height: item.height === null || item.height === undefined ? null : Number(item.height),
        blurhash: typeof item.blurhash === 'string' ? item.blurhash : null,
        thumbnailUrl,
        processingError: typeof item.processingError === 'string' ? item.processingError : null,
        persons: (Array.isArray(item.taggedPersonSlugs) ? (item.taggedPersonSlugs as string[]) : [])
          .map((slug) => personMap.get(slug))
          .filter((p): p is PersonTag => !!p),
        helpWanted: item.helpWanted === true,
      });
    }
    ExclusiveStartKey = result.LastEvaluatedKey;
  } while (ExclusiveStartKey);

  rows.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));

  return json(200, { items: rows });
};
