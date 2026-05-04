import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';
import { DynamoDBClient, TransactionCanceledException } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  ScanCommand,
  TransactWriteCommand,
} from '@aws-sdk/lib-dynamodb';
import { FREEZE_ERROR_MESSAGE, getConfig, isFrozenForCaller } from './config-shared';
import { json, parseGroups } from './users-shared';

const region = process.env.AWS_REGION ?? 'eu-west-1';
const tableName = process.env.TABLE_NAME!;
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region }));

/** PATCH /photos/{id}/priority — re-rank the caller's photos in their
 * own house by swapping with the immediate neighbour above or below.
 *
 * Body: { direction: 'up' | 'down' }.
 *
 * Auth: caller must be the photo's uploader. Admins are intentionally
 * blocked here — priority is a member-only concept (the user's own
 * ranking of their book contributions). Stage-2 freeze applies. */
export const handler = async (event: APIGatewayProxyEventV2WithJWTAuthorizer) => {
  const claims = event.requestContext.authorizer?.jwt?.claims ?? {};
  const callerSub = typeof claims.sub === 'string' ? claims.sub : '';
  if (!callerSub) return json(401, { error: 'Unauthorized' });

  const isAdminCaller = parseGroups(claims['cognito:groups']).includes('admin');

  const photoId = event.pathParameters?.id;
  if (!photoId || !/^[0-9a-f-]{36}$/.test(photoId)) {
    return json(400, { error: 'Ugyldigt billede-id' });
  }

  let body: { direction?: unknown };
  try {
    body = JSON.parse(event.body ?? '{}');
  } catch {
    return json(400, { error: 'Request body must be valid JSON' });
  }
  const direction = body.direction === 'up' || body.direction === 'down' ? body.direction : null;
  if (!direction) return json(400, { error: "direction must be 'up' or 'down'" });

  const cfg = await getConfig(ddb, tableName);
  if (isFrozenForCaller(cfg, isAdminCaller)) {
    return json(423, { error: FREEZE_ERROR_MESSAGE });
  }

  const photo = await ddb.send(
    new GetCommand({ TableName: tableName, Key: { PK: `PHOTO#${photoId}`, SK: 'META' } }),
  );
  if (!photo.Item) return json(404, { error: 'Billedet findes ikke' });
  if (photo.Item.uploaderSub !== callerSub) {
    return json(403, { error: 'Du kan kun ændre rækkefølgen på dine egne billeder.' });
  }
  const ownPriority =
    typeof photo.Item.priority === 'number' ? (photo.Item.priority as number) : null;
  if (ownPriority === null) {
    return json(400, { error: 'Dette billede har ingen prioritet at flytte rundt på.' });
  }
  const houseNumbers = Array.isArray(photo.Item.houseNumbers)
    ? photo.Item.houseNumbers.map(Number)
    : [];
  if (houseNumbers.length !== 1) {
    return json(400, { error: 'Prioritet bruges kun på husbidrag.' });
  }
  const house = houseNumbers[0];

  // Fetch all of the caller's photos in this house that have a priority.
  type Slot = { photoId: string; priority: number };
  const slots: Slot[] = [];
  let ExclusiveStartKey: Record<string, unknown> | undefined;
  do {
    const r = await ddb.send(
      new ScanCommand({
        TableName: tableName,
        FilterExpression:
          'entity = :p AND uploaderSub = :u AND contains(houseNumbers, :h) AND attribute_exists(priority)',
        ExpressionAttributeValues: { ':p': 'Photo', ':u': callerSub, ':h': house },
        ProjectionExpression: 'photoId, priority',
        ExclusiveStartKey,
      }),
    );
    for (const it of r.Items ?? []) {
      if (typeof it.photoId === 'string' && typeof it.priority === 'number') {
        slots.push({ photoId: it.photoId, priority: it.priority });
      }
    }
    ExclusiveStartKey = r.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  slots.sort((a, b) => a.priority - b.priority);

  const idx = slots.findIndex((s) => s.photoId === photoId);
  if (idx < 0) {
    return json(500, { error: 'Kunne ikke finde billedet i din liste.' });
  }
  const otherIdx = direction === 'up' ? idx - 1 : idx + 1;
  if (otherIdx < 0 || otherIdx >= slots.length) {
    return json(409, {
      error: direction === 'up'
        ? 'Billedet er allerede øverst.'
        : 'Billedet er allerede nederst.',
    });
  }

  const a = slots[idx];
  const b = slots[otherIdx];

  // Atomic swap. ConditionExpressions guard against a concurrent change
  // racing us between the scan and the write.
  try {
    await ddb.send(
      new TransactWriteCommand({
        TransactItems: [
          {
            Update: {
              TableName: tableName,
              Key: { PK: `PHOTO#${a.photoId}`, SK: 'META' },
              UpdateExpression: 'SET priority = :new',
              ConditionExpression: 'priority = :old AND uploaderSub = :u',
              ExpressionAttributeValues: { ':new': b.priority, ':old': a.priority, ':u': callerSub },
            },
          },
          {
            Update: {
              TableName: tableName,
              Key: { PK: `PHOTO#${b.photoId}`, SK: 'META' },
              UpdateExpression: 'SET priority = :new',
              ConditionExpression: 'priority = :old AND uploaderSub = :u',
              ExpressionAttributeValues: { ':new': a.priority, ':old': b.priority, ':u': callerSub },
            },
          },
        ],
      }),
    );
  } catch (err) {
    if (err instanceof TransactionCanceledException) {
      return json(409, { error: 'En anden ændring kom imellem. Prøv igen.' });
    }
    throw err;
  }

  return json(200, { photoId: a.photoId, priority: b.priority });
};
