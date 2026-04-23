import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, BatchGetCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const region = process.env.AWS_REGION ?? 'eu-west-1';
const tableName = process.env.TABLE_NAME!;
const derivedBucket = process.env.DERIVED_BUCKET!;
const THUMB_URL_TTL = 600;

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

export const handler = async (event: APIGatewayProxyEventV2WithJWTAuthorizer) => {
  const claims = event.requestContext.authorizer?.jwt?.claims ?? {};
  const groups = parseGroups(claims['cognito:groups']);
  if (!groups.includes('admin')) return json(403, { error: 'Admin only' });

  const removals: Record<string, unknown>[] = [];
  let ExclusiveStartKey: Record<string, unknown> | undefined;
  do {
    const r = await ddb.send(
      new QueryCommand({
        TableName: tableName,
        IndexName: 'GSI1',
        KeyConditionExpression: 'GSI1PK = :pk',
        ExpressionAttributeValues: { ':pk': 'REMOVALSTATUS#pending' },
        ExclusiveStartKey,
      }),
    );
    for (const it of r.Items ?? []) removals.push(it);
    ExclusiveStartKey = r.LastEvaluatedKey;
  } while (ExclusiveStartKey);

  removals.sort((a, b) => String(a.createdAt ?? '').localeCompare(String(b.createdAt ?? '')));

  const photoIds = Array.from(new Set(removals.map((r) => String(r.photoId))));
  const photoRows = new Map<string, Record<string, unknown>>();
  for (let i = 0; i < photoIds.length; i += 100) {
    const chunk = photoIds.slice(i, i + 100);
    const got = await ddb.send(
      new BatchGetCommand({
        RequestItems: {
          [tableName]: {
            Keys: chunk.map((id) => ({ PK: `PHOTO#${id}`, SK: 'META' })),
          },
        },
      }),
    );
    for (const row of got.Responses?.[tableName] ?? []) {
      photoRows.set(String(row.photoId), row);
    }
  }

  const rows = await Promise.all(
    removals.map(async (r) => {
      const photo = photoRows.get(String(r.photoId));
      const thumbKey = photo && typeof photo.derivedThumbKey === 'string' ? photo.derivedThumbKey : null;
      const thumbnailUrl = thumbKey
        ? await getSignedUrl(s3, new GetObjectCommand({ Bucket: derivedBucket, Key: thumbKey }), { expiresIn: THUMB_URL_TTL })
        : null;
      return {
        removalId: String(r.removalId),
        photoId: String(r.photoId),
        photoShortId:
          photo && photo.shortId !== null && photo.shortId !== undefined ? Number(photo.shortId) : null,
        photoExists: !!photo,
        photoDescription: photo ? String(photo.description ?? '') : '',
        photoYear: photo && photo.year !== null && photo.year !== undefined ? Number(photo.year) : null,
        photoYearApprox: !!(photo && photo.yearApprox === true),
        photoHouseNumbers:
          photo && Array.isArray(photo.houseNumbers) ? (photo.houseNumbers as number[]).map(Number) : [],
        reason: String(r.reason ?? ''),
        requestorLoginName: typeof r.requestorLoginName === 'string' ? r.requestorLoginName : '',
        requestorEmail: typeof r.requestorEmail === 'string' ? r.requestorEmail : '',
        requestorRole: typeof r.requestorRole === 'string' ? r.requestorRole : '',
        createdAt: String(r.createdAt ?? ''),
        thumbnailUrl,
      };
    }),
  );

  return json(200, { items: rows });
};
