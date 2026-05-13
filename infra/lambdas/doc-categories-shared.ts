import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';

/**
 * Admin-managed document categories. Mirrors the Aktiviteter pattern.
 *
 * PK = `DOCCATEGORYLIST`, SK = `CATEGORY#<key>`.
 *
 * `key` is a slug derived from `displayName` at create-time; once
 * created, the key is immutable. Renaming (changing displayName)
 * preserves the key so existing DOC rows that reference the category
 * by *displayName* keep their human label after the rename. The
 * displayName is what the client uploads, so renaming a category does
 * NOT retroactively change existing docs — they keep whatever name was
 * in effect at upload time. That's deliberate: a typo fix shouldn't
 * silently rewrite years of audit-relevant metadata.
 */
export const DOCCATEGORYLIST_PK = 'DOCCATEGORYLIST';
export const DOC_CATEGORY_SK_PREFIX = 'CATEGORY#';

export interface DocCategoryRow {
  key: string;
  displayName: string;
  displayOrder: number;
  createdAt: string | null;
  createdBy: string | null;
}

/** Fetch all approved displayNames for runtime validation. The list is
 * tiny (~10 entries), so each upload/edit can afford a fresh query. */
export const loadDocCategoryNames = async (
  ddb: DynamoDBDocumentClient,
  tableName: string,
): Promise<Set<string>> => {
  const names = new Set<string>();
  let ExclusiveStartKey: Record<string, unknown> | undefined;
  do {
    const r = await ddb.send(
      new QueryCommand({
        TableName: tableName,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
        ExpressionAttributeValues: { ':pk': DOCCATEGORYLIST_PK, ':sk': DOC_CATEGORY_SK_PREFIX },
        ProjectionExpression: 'displayName',
        ExclusiveStartKey,
      }),
    );
    for (const it of r.Items ?? []) {
      const dn = typeof it.displayName === 'string' ? it.displayName : '';
      if (dn) names.add(dn);
    }
    ExclusiveStartKey = r.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return names;
};
