import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { loadActivityNameMap } from './activities-shared';
import { PERSON_SK_PREFIX, PERSONLIST_PK } from './persons-shared';

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

const parseGroups = (raw: unknown): string[] => {
  if (Array.isArray(raw)) return raw.map(String);
  if (typeof raw === 'string') return raw.replace(/^\[|\]$/g, '').split(/[\s,]+/).filter(Boolean);
  return [];
};

interface PersonTag { slug: string; displayName: string; state: string; }

export const handler = async (event: APIGatewayProxyEventV2WithJWTAuthorizer) => {
  const claims = event.requestContext.authorizer?.jwt?.claims ?? {};
  const groups = parseGroups(claims['cognito:groups']);
  if (!groups.includes('admin')) return json(403, { error: 'Book list is restricted to admins' });

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

  const selected = items.filter((it) => it.visibilityBook === true);

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
      const slug = typeof it.slug === 'string' ? it.slug : '';
      if (!slug) continue;
      personMap.set(slug, {
        slug,
        displayName: String(it.displayName ?? slug),
        state: String(it.state ?? ''),
      });
    }
    personEsk = p.LastEvaluatedKey;
  } while (personEsk);

  const activityMap = await loadActivityNameMap(ddb, tableName);

  selected.sort((a, b) => {
    const sa = a.shortId === null || a.shortId === undefined ? 9_999_999 : Number(a.shortId);
    const sb = b.shortId === null || b.shortId === undefined ? 9_999_999 : Number(b.shortId);
    return sa - sb;
  });

  const rows = await Promise.all(
    selected.map(async (item) => {
      const thumbKey = typeof item.derivedThumbKey === 'string' ? item.derivedThumbKey : null;
      const bookKey = typeof item.derivedBookKey === 'string' ? item.derivedBookKey : null;
      const thumbnailUrl = thumbKey
        ? await getSignedUrl(s3, new GetObjectCommand({ Bucket: derivedBucket, Key: thumbKey }), { expiresIn: URL_TTL })
        : null;
      const bookUrl = bookKey
        ? await getSignedUrl(
            s3,
            new GetObjectCommand({
              Bucket: derivedBucket,
              Key: bookKey,
              ResponseContentDisposition: `attachment; filename="${bookFilename(item)}"`,
            }),
            { expiresIn: URL_TTL },
          )
        : null;
      return {
        photoId: String(item.photoId),
        shortId: item.shortId === null || item.shortId === undefined ? null : Number(item.shortId),
        description: String(item.description ?? ''),
        whoInPhoto: String(item.whoInPhoto ?? ''),
        year: item.year === null || item.year === undefined ? null : Number(item.year),
        yearApprox: item.yearApprox === true,
        houseNumbers: Array.isArray(item.houseNumbers) ? item.houseNumbers.map(Number) : [],
        originalFilename: String(item.originalFilename ?? ''),
        bookBytes: item.derivedBookBytes === null || item.derivedBookBytes === undefined ? null : Number(item.derivedBookBytes),
        bookReady: !!bookKey,
        thumbnailUrl,
        bookUrl,
        persons: (Array.isArray(item.taggedPersonSlugs) ? (item.taggedPersonSlugs as string[]) : [])
          .map((slug) => personMap.get(slug))
          .filter((p): p is PersonTag => !!p)
          .map((p) => ({ slug: p.slug, displayName: p.displayName, state: p.state })),
        activityKey: typeof item.activityKey === 'string' ? item.activityKey : null,
        activityName:
          typeof item.activityKey === 'string' ? activityMap.get(item.activityKey) ?? null : null,
      };
    }),
  );

  return json(200, { items: rows });
};

const bookFilename = (item: Record<string, unknown>): string => {
  const n = item.shortId === null || item.shortId === undefined ? null : Number(item.shortId);
  return n === null ? `${String(item.photoId)}.jpg` : `ID-${String(n).padStart(5, '0')}.jpg`;
};
