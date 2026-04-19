import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { callerGroups, isAdmin, json, PERSON_SK_PREFIX, PERSONLIST_PK } from './persons-shared';

const region = process.env.AWS_REGION ?? 'eu-west-1';
const tableName = process.env.TABLE_NAME!;

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region }));

export const handler = async (event: APIGatewayProxyEventV2WithJWTAuthorizer) => {
  if (!event.requestContext.authorizer?.jwt?.claims) return json(401, { error: 'Unauthorized' });

  const groups = callerGroups(event);
  const hasMemberOrAdmin = groups.some((g) => g === 'admin' || g === 'member');
  // Viewers only see approved (so the autocomplete on their gallery filter stays clean);
  // admins/committee see everything including pending.
  const includePending = isAdmin(event);
  const includeAll = isAdmin(event);

  const items: Record<string, unknown>[] = [];
  let ExclusiveStartKey: Record<string, unknown> | undefined;
  do {
    const r = await ddb.send(
      new QueryCommand({
        TableName: tableName,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
        ExpressionAttributeValues: { ':pk': PERSONLIST_PK, ':sk': PERSON_SK_PREFIX },
        ExclusiveStartKey,
      }),
    );
    for (const it of r.Items ?? []) items.push(it);
    ExclusiveStartKey = r.LastEvaluatedKey;
  } while (ExclusiveStartKey);

  // For upload-time autocomplete, members also need to see pending entries so
  // they can reuse an existing proposal instead of creating a duplicate.
  const wantPending = includePending || hasMemberOrAdmin;

  const rows = items
    .filter((it) => {
      const state = String(it.state ?? '');
      if (state === 'approved') return true;
      if (state === 'pending' && wantPending) return true;
      return false;
    })
    .map((it) => ({
      slug: String(it.slug),
      displayName: String(it.displayName ?? ''),
      state: String(it.state ?? ''),
      proposedBy: typeof it.proposedBy === 'string' ? it.proposedBy : null,
      proposedByEmail: typeof it.proposedByEmail === 'string' ? it.proposedByEmail : null,
      proposedAt: typeof it.proposedAt === 'string' ? it.proposedAt : null,
      approvedAt: typeof it.approvedAt === 'string' ? it.approvedAt : null,
    }))
    .sort((a, b) => a.displayName.localeCompare(b.displayName, 'da'));

  return json(200, { items: rows, includeAll });
};
