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

  const comments: Record<string, unknown>[] = [];
  let ExclusiveStartKey: Record<string, unknown> | undefined;
  do {
    const r = await ddb.send(
      new QueryCommand({
        TableName: tableName,
        IndexName: 'GSI1',
        KeyConditionExpression: 'GSI1PK = :pk',
        ExpressionAttributeValues: { ':pk': 'COMMENTSTATUS#pending' },
        ExclusiveStartKey,
      }),
    );
    for (const it of r.Items ?? []) comments.push(it);
    ExclusiveStartKey = r.LastEvaluatedKey;
  } while (ExclusiveStartKey);

  comments.sort((a, b) => String(a.createdAt ?? '').localeCompare(String(b.createdAt ?? '')));

  // Batch-load the photos referenced so the queue UI can show context.
  const photoIds = Array.from(new Set(comments.map((c) => String(c.photoId))));
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
    comments.map(async (c) => {
      const photo = photoRows.get(String(c.photoId));
      const thumbKey = photo && typeof photo.derivedThumbKey === 'string' ? photo.derivedThumbKey : null;
      const thumbnailUrl = thumbKey
        ? await getSignedUrl(s3, new GetObjectCommand({ Bucket: derivedBucket, Key: thumbKey }), { expiresIn: THUMB_URL_TTL })
        : null;
      return {
        commentId: String(c.commentId),
        photoId: String(c.photoId),
        body: String(c.body ?? ''),
        authorLoginName: typeof c.authorLoginName === 'string' ? c.authorLoginName : '',
        authorEmail: typeof c.authorEmail === 'string' ? c.authorEmail : '',
        authorRole: typeof c.authorRole === 'string' ? c.authorRole : '',
        createdAt: String(c.createdAt ?? ''),
        thumbnailUrl,
        photoDescription: photo ? String(photo.description ?? '') : '',
        photoPersonSlugs:
          photo && Array.isArray(photo.taggedPersonSlugs) ? (photo.taggedPersonSlugs as string[]) : [],
        photoYear: photo && photo.year !== null && photo.year !== undefined ? Number(photo.year) : null,
        photoYearApprox: !!(photo && photo.yearApprox === true),
        photoHouseNumbers:
          photo && Array.isArray(photo.houseNumbers) ? (photo.houseNumbers as number[]).map(Number) : [],
      };
    }),
  );

  return json(200, { items: rows });
};
