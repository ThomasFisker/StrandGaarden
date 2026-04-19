import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand } from '@aws-sdk/lib-dynamodb';

const region = process.env.AWS_REGION ?? 'eu-west-1';
const tableName = process.env.TABLE_NAME!;

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region }));

const json = (statusCode: number, body: unknown) => ({
  statusCode,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

interface PhotoRow {
  photoId: string;
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
}

export const handler = async (event: APIGatewayProxyEventV2WithJWTAuthorizer) => {
  const claims = event.requestContext.authorizer?.jwt?.claims ?? {};
  const sub = typeof claims.sub === 'string' ? claims.sub : null;
  if (!sub) return json(401, { error: 'Missing subject claim' });

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
      rows.push({
        photoId: String(item.photoId),
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
      });
    }
    ExclusiveStartKey = result.LastEvaluatedKey;
  } while (ExclusiveStartKey);

  rows.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));

  return json(200, { items: rows });
};
