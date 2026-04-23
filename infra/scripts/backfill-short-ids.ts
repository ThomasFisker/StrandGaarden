/**
 * One-off backfill: assign sequential shortId (1..N) to every existing Photo
 * in createdAt order, then seed the atomic counter at N so future uploads
 * continue from N+1. Idempotent — rows that already carry a shortId are
 * skipped, and the counter is set to max(existing, N).
 *
 * Run with:
 *   AWS_PROFILE=strandgaarden AWS_REGION=eu-west-1 \
 *     npx tsx infra/scripts/backfill-short-ids.ts
 *
 * Dry-run (prints the plan, writes nothing):
 *   DRY_RUN=1 AWS_PROFILE=strandgaarden AWS_REGION=eu-west-1 \
 *     npx tsx infra/scripts/backfill-short-ids.ts
 */
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';

const TABLE = 'strandgaarden-dev-data';
const REGION = process.env.AWS_REGION ?? 'eu-west-1';
const DRY = process.env.DRY_RUN === '1';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }));

const main = async () => {
  const photos: Array<{ photoId: string; PK: string; SK: string; createdAt: string; shortId?: number }> = [];
  let ExclusiveStartKey: Record<string, unknown> | undefined;
  do {
    const r = await ddb.send(
      new ScanCommand({
        TableName: TABLE,
        FilterExpression: 'entity = :p',
        ExpressionAttributeValues: { ':p': 'Photo' },
        ExclusiveStartKey,
      }),
    );
    for (const it of r.Items ?? []) {
      photos.push({
        photoId: String(it.photoId),
        PK: String(it.PK),
        SK: String(it.SK),
        createdAt: String(it.createdAt ?? ''),
        shortId: typeof it.shortId === 'number' ? it.shortId : undefined,
      });
    }
    ExclusiveStartKey = r.LastEvaluatedKey;
  } while (ExclusiveStartKey);

  photos.sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0));

  const maxExisting = photos.reduce((m, p) => (p.shortId && p.shortId > m ? p.shortId : m), 0);
  let cursor = maxExisting;
  const plan: Array<{ photoId: string; id: number }> = [];
  for (const p of photos) {
    if (p.shortId) continue;
    cursor += 1;
    plan.push({ photoId: p.photoId, id: cursor });
  }

  console.log(`Total photos: ${photos.length}`);
  console.log(`Already have shortId: ${photos.length - plan.length}`);
  console.log(`Max existing shortId: ${maxExisting}`);
  console.log(`To assign: ${plan.length} (${maxExisting + 1} … ${cursor})`);

  if (plan.length === 0 && maxExisting === 0) {
    console.log('Nothing to do.');
    return;
  }

  if (DRY) {
    console.log('--- DRY RUN plan ---');
    for (const row of plan.slice(0, 20)) console.log(`  ${row.photoId}  →  ID-${String(row.id).padStart(5, '0')}`);
    if (plan.length > 20) console.log(`  … +${plan.length - 20} more`);
    console.log(`(would also seed COUNTER#PHOTOID nextId = ${cursor})`);
    return;
  }

  // Apply assignments
  for (const row of plan) {
    const photo = photos.find((p) => p.photoId === row.photoId)!;
    await ddb.send(
      new UpdateCommand({
        TableName: TABLE,
        Key: { PK: photo.PK, SK: photo.SK },
        UpdateExpression: 'SET shortId = :s',
        ConditionExpression: 'attribute_not_exists(shortId)',
        ExpressionAttributeValues: { ':s': row.id },
      }),
    );
    console.log(`  ${row.photoId} → ID-${String(row.id).padStart(5, '0')}`);
  }

  // Seed / advance the counter to `cursor` so new uploads continue from cursor+1.
  await ddb.send(
    new UpdateCommand({
      TableName: TABLE,
      Key: { PK: 'COUNTER#PHOTOID', SK: 'META' },
      UpdateExpression: 'SET nextId = :c, entity = :e',
      ConditionExpression: 'attribute_not_exists(nextId) OR nextId < :c',
      ExpressionAttributeValues: { ':c': cursor, ':e': 'Counter' },
    }),
  ).catch((err) => {
    // If the counter is already >= cursor, that's fine.
    if (err.name !== 'ConditionalCheckFailedException') throw err;
    console.log('(counter already >= assigned max — left alone)');
  });

  console.log(`Done. Counter seeded at ${cursor}.`);
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
