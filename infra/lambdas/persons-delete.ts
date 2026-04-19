import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  DeleteCommand,
  ScanCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { isAdmin, json, jsonNoContent, PERSON_SK_PREFIX, PERSONLIST_PK } from './persons-shared';

const region = process.env.AWS_REGION ?? 'eu-west-1';
const tableName = process.env.TABLE_NAME!;

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region }));

/**
 * Delete a person and scrub their slug from every photo that references it.
 * Used for both "reject pending proposal" and "remove approved person".
 * Small N (≤500 photos) so scan+per-photo update is fine.
 */
export const handler = async (event: APIGatewayProxyEventV2WithJWTAuthorizer) => {
  if (!isAdmin(event)) return json(403, { error: 'Admin only' });

  const slug = event.pathParameters?.slug;
  if (!slug) return json(400, { error: 'Missing slug' });

  let ExclusiveStartKey: Record<string, unknown> | undefined;
  do {
    const scan = await ddb.send(
      new ScanCommand({
        TableName: tableName,
        FilterExpression: 'entity = :p AND contains(taggedPersonSlugs, :slug)',
        ExpressionAttributeValues: { ':p': 'Photo', ':slug': slug },
        ExclusiveStartKey,
      }),
    );
    for (const item of scan.Items ?? []) {
      const current = Array.isArray(item.taggedPersonSlugs)
        ? (item.taggedPersonSlugs as string[])
        : [];
      const next = current.filter((s) => s !== slug);
      await ddb.send(
        new UpdateCommand({
          TableName: tableName,
          Key: { PK: item.PK, SK: item.SK },
          UpdateExpression: 'SET taggedPersonSlugs = :next',
          ExpressionAttributeValues: { ':next': next },
        }),
      );
    }
    ExclusiveStartKey = scan.LastEvaluatedKey;
  } while (ExclusiveStartKey);

  await ddb.send(
    new DeleteCommand({
      TableName: tableName,
      Key: { PK: PERSONLIST_PK, SK: `${PERSON_SK_PREFIX}${slug}` },
    }),
  );

  return jsonNoContent(204);
};
