import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';

export const ACTIVITYLIST_PK = 'ACTIVITYLIST';
export const ACTIVITY_SK_PREFIX = 'ACTIVITY#';

export interface ActivityRow {
  key: string;
  displayName: string;
  displayOrder: number;
  createdAt: string | null;
  createdBy: string | null;
}

/** key → displayName lookup. Cheap query (the activity list is tiny —
 * a handful of items at most), so each photo-listing lambda calls this
 * once per request to denormalize activityKey into a human label. */
export const loadActivityNameMap = async (
  ddb: DynamoDBDocumentClient,
  tableName: string,
): Promise<Map<string, string>> => {
  const map = new Map<string, string>();
  let ExclusiveStartKey: Record<string, unknown> | undefined;
  do {
    const r = await ddb.send(
      new QueryCommand({
        TableName: tableName,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
        ExpressionAttributeValues: { ':pk': ACTIVITYLIST_PK, ':sk': ACTIVITY_SK_PREFIX },
        ProjectionExpression: '#k, displayName',
        ExpressionAttributeNames: { '#k': 'key' },
        ExclusiveStartKey,
      }),
    );
    for (const it of r.Items ?? []) {
      const k = typeof it.key === 'string' ? it.key : '';
      const dn = typeof it.displayName === 'string' ? it.displayName : '';
      if (k) map.set(k, dn || k);
    }
    ExclusiveStartKey = r.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return map;
};
