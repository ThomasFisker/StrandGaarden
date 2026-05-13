import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';
import { DynamoDBClient, ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, DeleteCommand, ScanCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { canManageDocs } from './permissions';
import { docPk, META_SK, meetingPk } from './documents-shared';

const region = process.env.AWS_REGION ?? 'eu-west-1';
const tableName = process.env.TABLE_NAME!;
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region }));

const json = (statusCode: number, body: unknown) => ({
  statusCode,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

/**
 * Deletes a meeting. Attached documents are NOT cascade-deleted; they
 * become "orphaned" with `meetingId` set to null so the file itself
 * isn't lost when someone clicks the wrong button. Cleanup via the
 * separate documents-delete endpoint.
 */
export const handler = async (event: APIGatewayProxyEventV2WithJWTAuthorizer) => {
  const claims = event.requestContext.authorizer?.jwt?.claims;
  if (!claims) return json(401, { error: 'Unauthorized' });
  if (!canManageDocs(event)) return json(403, { error: 'Forbidden' });

  const meetingId = event.pathParameters?.id ?? '';
  if (!meetingId) return json(400, { error: 'Missing meeting id' });

  // Orphan any docs attached to this meeting.
  let ExclusiveStartKey: Record<string, unknown> | undefined;
  do {
    const r = await ddb.send(
      new ScanCommand({
        TableName: tableName,
        FilterExpression: 'entity = :p AND meetingId = :m',
        ExpressionAttributeValues: { ':p': 'Document', ':m': meetingId },
        ProjectionExpression: 'docId',
        ExclusiveStartKey,
      }),
    );
    for (const it of r.Items ?? []) {
      const docId = String(it.docId ?? '');
      if (!docId) continue;
      await ddb.send(
        new UpdateCommand({
          TableName: tableName,
          Key: { PK: docPk(docId), SK: META_SK },
          UpdateExpression: 'REMOVE meetingId',
        }),
      );
    }
    ExclusiveStartKey = r.LastEvaluatedKey;
  } while (ExclusiveStartKey);

  try {
    await ddb.send(
      new DeleteCommand({
        TableName: tableName,
        Key: { PK: meetingPk(meetingId), SK: META_SK },
        ConditionExpression: 'attribute_exists(PK)',
      }),
    );
  } catch (err) {
    if (err instanceof ConditionalCheckFailedException) return json(404, { error: 'Meeting not found' });
    throw err;
  }

  return json(200, { meetingId, deleted: true });
};
