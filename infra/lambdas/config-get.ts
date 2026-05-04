import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { getConfig } from './config-shared';
import { isAdmin, json } from './persons-shared';

const region = process.env.AWS_REGION ?? 'eu-west-1';
const tableName = process.env.TABLE_NAME!;
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region }));

export const handler = async (event: APIGatewayProxyEventV2WithJWTAuthorizer) => {
  if (!isAdmin(event)) return json(403, { error: 'Admin only' });
  const cfg = await getConfig(ddb, tableName);
  return json(200, cfg);
};
