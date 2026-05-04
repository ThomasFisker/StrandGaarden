import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, DeleteCommand } from '@aws-sdk/lib-dynamodb';
import { ACTIVITY_SK_PREFIX, ACTIVITYLIST_PK } from './activities-shared';
import { isAdmin, json, jsonNoContent } from './persons-shared';

const region = process.env.AWS_REGION ?? 'eu-west-1';
const tableName = process.env.TABLE_NAME!;
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region }));

export const handler = async (event: APIGatewayProxyEventV2WithJWTAuthorizer) => {
  if (!isAdmin(event)) return json(403, { error: 'Admin only' });

  const key = event.pathParameters?.key;
  if (!key) return json(400, { error: 'Missing key' });

  // Note: any photos that reference this activityKey are NOT scrubbed here.
  // Stage 1 isn't live yet so there can't be any references; once Stage 1 is
  // live this should grow a scrub step or refuse-if-referenced check.
  await ddb.send(
    new DeleteCommand({
      TableName: tableName,
      Key: { PK: ACTIVITYLIST_PK, SK: `${ACTIVITY_SK_PREFIX}${key}` },
    }),
  );
  return jsonNoContent(204);
};
