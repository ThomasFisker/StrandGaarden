import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
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

export const handler = async (event: APIGatewayProxyEventV2WithJWTAuthorizer) => {
  const qs = event.queryStringParameters ?? {};
  const yearParam = qs.year ? Number(qs.year) : NaN;
  const houseParam = qs.house ? Number(qs.house) : NaN;
  const yearFilter = Number.isFinite(yearParam) ? yearParam : null;
  const houseFilter = Number.isFinite(houseParam) ? houseParam : null;

  const items: Record<string, unknown>[] = [];
  let ExclusiveStartKey: Record<string, unknown> | undefined;
  do {
    const r = await ddb.send(
      new QueryCommand({
        TableName: tableName,
        IndexName: 'GSI1',
        KeyConditionExpression: 'GSI1PK = :pk',
        ExpressionAttributeValues: { ':pk': 'STATUS#Decided' },
        ExclusiveStartKey,
      }),
    );
    for (const it of r.Items ?? []) items.push(it);
    ExclusiveStartKey = r.LastEvaluatedKey;
  } while (ExclusiveStartKey);

  const visible = items.filter((it) => it.visibilityWeb === true);

  const years = new Set<number>();
  const houses = new Set<number>();
  for (const it of visible) {
    if (it.year !== null && it.year !== undefined) years.add(Number(it.year));
    const hs = Array.isArray(it.houseNumbers) ? it.houseNumbers : [];
    for (const h of hs) houses.add(Number(h));
  }

  const filtered = visible.filter((it) => {
    if (yearFilter !== null) {
      const y = it.year === null || it.year === undefined ? null : Number(it.year);
      if (y !== yearFilter) return false;
    }
    if (houseFilter !== null) {
      const hs = Array.isArray(it.houseNumbers) ? it.houseNumbers.map(Number) : [];
      if (!hs.includes(houseFilter)) return false;
    }
    return true;
  });

  filtered.sort((a, b) => {
    const ya = a.year === null || a.year === undefined ? 9999 : Number(a.year);
    const yb = b.year === null || b.year === undefined ? 9999 : Number(b.year);
    if (ya !== yb) return ya - yb;
    const ca = String(a.createdAt ?? '');
    const cb = String(b.createdAt ?? '');
    return ca < cb ? -1 : ca > cb ? 1 : 0;
  });

  const rows = await Promise.all(
    filtered.map(async (item) => {
      const thumbKey = typeof item.derivedThumbKey === 'string' ? item.derivedThumbKey : null;
      const thumbnailUrl = thumbKey
        ? await getSignedUrl(s3, new GetObjectCommand({ Bucket: derivedBucket, Key: thumbKey }), { expiresIn: URL_TTL })
        : null;
      return {
        photoId: String(item.photoId),
        description: String(item.description ?? ''),
        whoInPhoto: String(item.whoInPhoto ?? ''),
        year: item.year === null || item.year === undefined ? null : Number(item.year),
        yearApprox: item.yearApprox === true,
        houseNumbers: Array.isArray(item.houseNumbers) ? item.houseNumbers.map(Number) : [],
        width: item.width === null || item.width === undefined ? null : Number(item.width),
        height: item.height === null || item.height === undefined ? null : Number(item.height),
        blurhash: typeof item.blurhash === 'string' ? item.blurhash : null,
        thumbnailUrl,
      };
    }),
  );

  return json(200, {
    items: rows,
    filters: {
      years: Array.from(years).sort((a, b) => a - b),
      houses: Array.from(houses).sort((a, b) => a - b),
    },
  });
};
