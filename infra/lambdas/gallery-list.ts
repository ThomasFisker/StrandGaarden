import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { PERSON_SK_PREFIX, PERSONLIST_PK } from './persons-shared';

interface PersonTag { slug: string; displayName: string; state: string; }

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
  const personFilter = typeof qs.person === 'string' && qs.person.trim() ? qs.person.trim() : null;

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

  // Load approved persons once so we can render chips + drive the person filter.
  const personMap = new Map<string, PersonTag>();
  let personEsk: Record<string, unknown> | undefined;
  do {
    const p = await ddb.send(
      new QueryCommand({
        TableName: tableName,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
        ExpressionAttributeValues: { ':pk': PERSONLIST_PK, ':sk': PERSON_SK_PREFIX },
        ExclusiveStartKey: personEsk,
      }),
    );
    for (const it of p.Items ?? []) {
      if (it.state !== 'approved') continue;
      const slug = typeof it.slug === 'string' ? it.slug : '';
      if (!slug) continue;
      personMap.set(slug, { slug, displayName: String(it.displayName ?? slug), state: 'approved' });
    }
    personEsk = p.LastEvaluatedKey;
  } while (personEsk);

  const years = new Set<number>();
  const houses = new Set<number>();
  const personsWithVisiblePhoto = new Set<string>();
  for (const it of visible) {
    if (it.year !== null && it.year !== undefined) years.add(Number(it.year));
    const hs = Array.isArray(it.houseNumbers) ? it.houseNumbers : [];
    for (const h of hs) houses.add(Number(h));
    const ps = Array.isArray(it.taggedPersonSlugs) ? (it.taggedPersonSlugs as string[]) : [];
    for (const slug of ps) {
      if (personMap.has(slug)) personsWithVisiblePhoto.add(slug);
    }
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
    if (personFilter !== null) {
      const ps = Array.isArray(it.taggedPersonSlugs) ? (it.taggedPersonSlugs as string[]) : [];
      if (!ps.includes(personFilter)) return false;
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
        shortId: item.shortId !== null && item.shortId !== undefined ? Number(item.shortId) : null,
        description: String(item.description ?? ''),
        whoInPhoto: String(item.whoInPhoto ?? ''),
        year: item.year === null || item.year === undefined ? null : Number(item.year),
        yearApprox: item.yearApprox === true,
        houseNumbers: Array.isArray(item.houseNumbers) ? item.houseNumbers.map(Number) : [],
        width: item.width === null || item.width === undefined ? null : Number(item.width),
        height: item.height === null || item.height === undefined ? null : Number(item.height),
        blurhash: typeof item.blurhash === 'string' ? item.blurhash : null,
        thumbnailUrl,
        helpWanted: item.helpWanted === true,
        persons: (Array.isArray(item.taggedPersonSlugs) ? (item.taggedPersonSlugs as string[]) : [])
          .map((slug) => personMap.get(slug))
          .filter((p): p is PersonTag => !!p),
      };
    }),
  );

  const personOptions = Array.from(personsWithVisiblePhoto)
    .map((slug) => personMap.get(slug)!)
    .sort((a, b) => a.displayName.localeCompare(b.displayName, 'da'));

  return json(200, {
    items: rows,
    filters: {
      years: Array.from(years).sort((a, b) => a - b),
      houses: Array.from(houses).sort((a, b) => a - b),
      persons: personOptions.map((p) => ({ slug: p.slug, displayName: p.displayName })),
    },
  });
};
