import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const region = process.env.AWS_REGION ?? 'eu-west-1';
const tableName = process.env.TABLE_NAME!;
const derivedBucket = process.env.DERIVED_BUCKET!;
const URL_TTL = 600;

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
  if (!groups.includes('admin')) return json(403, { error: 'Review is restricted to admins' });

  const items: Record<string, unknown>[] = [];
  let ExclusiveStartKey: Record<string, unknown> | undefined;
  do {
    const r = await ddb.send(
      new QueryCommand({
        TableName: tableName,
        IndexName: 'GSI1',
        KeyConditionExpression: 'GSI1PK = :pk',
        ExpressionAttributeValues: { ':pk': 'STATUS#In Review' },
        ExclusiveStartKey,
      }),
    );
    for (const it of r.Items ?? []) items.push(it);
    ExclusiveStartKey = r.LastEvaluatedKey;
  } while (ExclusiveStartKey);

  const rows = await Promise.all(
    items.map(async (item) => {
      const thumbKey = typeof item.derivedThumbKey === 'string' ? item.derivedThumbKey : null;
      const webKey = typeof item.derivedWebKey === 'string' ? item.derivedWebKey : null;
      const [thumbnailUrl, webUrl] = await Promise.all([
        thumbKey
          ? getSignedUrl(s3, new GetObjectCommand({ Bucket: derivedBucket, Key: thumbKey }), { expiresIn: URL_TTL })
          : Promise.resolve(null as string | null),
        webKey
          ? getSignedUrl(s3, new GetObjectCommand({ Bucket: derivedBucket, Key: webKey }), { expiresIn: URL_TTL })
          : Promise.resolve(null as string | null),
      ]);
      return {
        photoId: String(item.photoId),
        status: String(item.status),
        createdAt: String(item.createdAt),
        processedAt: item.processedAt ? String(item.processedAt) : null,
        originalFilename: String(item.originalFilename ?? ''),
        description: String(item.description ?? ''),
        whoInPhoto: String(item.whoInPhoto ?? ''),
        year: item.year === null || item.year === undefined ? null : Number(item.year),
        yearApprox: item.yearApprox === true,
        houseNumbers: Array.isArray(item.houseNumbers) ? item.houseNumbers.map(Number) : [],
        uploaderEmail: typeof item.uploaderEmail === 'string' ? item.uploaderEmail : null,
        width: item.width === null || item.width === undefined ? null : Number(item.width),
        height: item.height === null || item.height === undefined ? null : Number(item.height),
        visibilityWeb: item.visibilityWeb === true,
        visibilityBook: item.visibilityBook === true,
        thumbnailUrl,
        webUrl,
      };
    }),
  );

  rows.sort((a, b) => {
    const ap = a.processedAt ?? '';
    const bp = b.processedAt ?? '';
    return ap < bp ? -1 : ap > bp ? 1 : 0;
  });

  return json(200, { items: rows });
};
