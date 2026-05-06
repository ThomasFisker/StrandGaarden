import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  ScanCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { ACTIVITY_SK_PREFIX, ACTIVITYLIST_PK } from './activities-shared';
import { FREEZE_ERROR_MESSAGE, getConfig, isFrozenForCaller } from './config-shared';
import { json, parseGroups, USER_SK, userPk } from './users-shared';

const region = process.env.AWS_REGION ?? 'eu-west-1';
const tableName = process.env.TABLE_NAME!;
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region }));

const countPriorityPhotosForHouse = async (house: number): Promise<number> => {
  let count = 0;
  let ExclusiveStartKey: Record<string, unknown> | undefined;
  do {
    const r = await ddb.send(
      new ScanCommand({
        TableName: tableName,
        FilterExpression:
          'entity = :p AND contains(houseNumbers, :h) AND attribute_exists(priority)',
        ExpressionAttributeValues: { ':p': 'Photo', ':h': house },
        ProjectionExpression: 'photoId',
        ExclusiveStartKey,
      }),
    );
    count += r.Items?.length ?? 0;
    ExclusiveStartKey = r.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return count;
};

const nextFreePriority = async (
  sub: string,
  house: number,
  max: number,
): Promise<number | null> => {
  const used = new Set<number>();
  let ExclusiveStartKey: Record<string, unknown> | undefined;
  do {
    const r = await ddb.send(
      new ScanCommand({
        TableName: tableName,
        FilterExpression:
          'entity = :p AND uploaderSub = :u AND contains(houseNumbers, :h) AND attribute_exists(priority)',
        ExpressionAttributeValues: { ':p': 'Photo', ':u': sub, ':h': house },
        ProjectionExpression: 'priority',
        ExclusiveStartKey,
      }),
    );
    for (const it of r.Items ?? []) {
      if (typeof it.priority === 'number') used.add(it.priority);
    }
    ExclusiveStartKey = r.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  for (let n = 1; n <= max; n++) if (!used.has(n)) return n;
  return null;
};

/** PATCH /photos/{id}/section — uploader-only re-tagging of one of their
 * own photos between the Stage-1 "house" section (carries a priority
 * slot in the user's house) and the "other" section (no priority).
 *
 * Body shapes:
 *   { target: 'house' }                          — assign next free
 *                                                  priority in caller's
 *                                                  own house, set
 *                                                  houseNumbers=[myHouse],
 *                                                  clear activityKey
 *   { target: 'activity', activityKey: '...' }   — clear priority,
 *                                                  clear houseNumbers,
 *                                                  set activityKey
 *   { target: 'other' }                          — clear priority,
 *                                                  leave houseNumbers
 *                                                  and activityKey as-is
 *
 * Auth: caller must be the photo's uploader. Admins are blocked here —
 * they re-tag via the admin photos-update endpoint. Stage-2 freeze and
 * Stage-1 cap apply on the way to the house side. */
export const handler = async (event: APIGatewayProxyEventV2WithJWTAuthorizer) => {
  const claims = event.requestContext.authorizer?.jwt?.claims ?? {};
  const callerSub = typeof claims.sub === 'string' ? claims.sub : '';
  if (!callerSub) return json(401, { error: 'Unauthorized' });
  const callerEmail = typeof claims.email === 'string' ? claims.email : '';

  const isAdminCaller = parseGroups(claims['cognito:groups']).includes('admin');

  const photoId = event.pathParameters?.id;
  if (!photoId || !/^[0-9a-f-]{36}$/.test(photoId)) {
    return json(400, { error: 'Ugyldigt billede-id' });
  }

  let body: { target?: unknown; activityKey?: unknown };
  try {
    body = JSON.parse(event.body ?? '{}');
  } catch {
    return json(400, { error: 'Request body must be valid JSON' });
  }
  const target = body.target;
  if (target !== 'house' && target !== 'activity' && target !== 'other') {
    return json(400, { error: "target must be 'house', 'activity' or 'other'" });
  }

  const cfg = await getConfig(ddb, tableName);
  if (isFrozenForCaller(cfg, isAdminCaller)) {
    return json(423, { error: FREEZE_ERROR_MESSAGE });
  }

  const photo = await ddb.send(
    new GetCommand({ TableName: tableName, Key: { PK: `PHOTO#${photoId}`, SK: 'META' } }),
  );
  if (!photo.Item) return json(404, { error: 'Billedet findes ikke' });
  if (photo.Item.uploaderSub !== callerSub) {
    return json(403, { error: 'Du kan kun flytte dine egne billeder.' });
  }

  const oldHouseNumbers = Array.isArray(photo.Item.houseNumbers)
    ? photo.Item.houseNumbers.map(Number)
    : [];
  const oldActivityKey =
    typeof photo.Item.activityKey === 'string' ? (photo.Item.activityKey as string) : null;
  const oldPriority =
    typeof photo.Item.priority === 'number' ? (photo.Item.priority as number) : null;

  const userRow = await ddb.send(
    new GetCommand({ TableName: tableName, Key: { PK: userPk(callerSub), SK: USER_SK } }),
  );
  const myHouse =
    userRow.Item && typeof userRow.Item.houseNumber === 'number'
      ? (userRow.Item.houseNumber as number)
      : null;

  const now = new Date().toISOString();

  if (target === 'house') {
    if (myHouse === null) {
      return json(400, {
        error: 'Du er ikke tildelt et hus. Bed udvalget om at tildele dig et hus først.',
      });
    }
    if (oldPriority !== null && oldHouseNumbers.length === 1 && oldHouseNumbers[0] === myHouse) {
      return json(409, { error: 'Billedet ligger allerede under Mine Hus Billeder.' });
    }
    const used = await countPriorityPhotosForHouse(myHouse);
    if (used >= cfg.maxBookSlotsPerHouse) {
      return json(409, {
        error: `Hus ${myHouse} har allerede ${used} af ${cfg.maxBookSlotsPerHouse} mulige billeder. Slet eller flyt et hus-billede først.`,
      });
    }
    const newPriority = await nextFreePriority(callerSub, myHouse, cfg.maxBookSlotsPerHouse);
    if (newPriority === null) {
      return json(409, {
        error: `Hus ${myHouse} har allerede ${cfg.maxBookSlotsPerHouse} billeder.`,
      });
    }

    const exprValues: Record<string, unknown> = {
      ':h': [myHouse],
      ':pr': newPriority,
      ':at': now,
      ':by': callerEmail || callerSub,
    };
    let updateExpr = 'SET houseNumbers = :h, priority = :pr, lastEditedAt = :at, lastEditedBy = :by';
    if (oldActivityKey !== null) {
      updateExpr += ' REMOVE activityKey';
    }
    await ddb.send(
      new UpdateCommand({
        TableName: tableName,
        Key: { PK: `PHOTO#${photoId}`, SK: 'META' },
        UpdateExpression: updateExpr,
        ExpressionAttributeValues: exprValues,
      }),
    );

    await ddb.send(
      new PutCommand({
        TableName: tableName,
        Item: {
          PK: `PHOTO#${photoId}`,
          SK: `AUDIT#${now}#section-moved`,
          entity: 'Audit',
          event: 'SectionMoved',
          at: now,
          by: callerEmail || callerSub,
          details: {
            from: { houseNumbers: oldHouseNumbers, activityKey: oldActivityKey, priority: oldPriority },
            to: { houseNumbers: [myHouse], activityKey: null, priority: newPriority },
          },
        },
      }),
    );

    return json(200, { photoId, target: 'house', priority: newPriority, houseNumbers: [myHouse] });
  }

  if (target === 'activity') {
    const activityKey = typeof body.activityKey === 'string' ? body.activityKey.trim() : '';
    if (!activityKey) {
      return json(400, { error: "activityKey is required when target is 'activity'" });
    }
    const ar = await ddb.send(
      new GetCommand({
        TableName: tableName,
        Key: { PK: ACTIVITYLIST_PK, SK: `${ACTIVITY_SK_PREFIX}${activityKey}` },
        ProjectionExpression: 'displayName',
      }),
    );
    if (!ar.Item) return json(400, { error: `Ukendt aktivitet: ${activityKey}` });

    const exprValues: Record<string, unknown> = {
      ':h': [],
      ':a': activityKey,
      ':at': now,
      ':by': callerEmail || callerSub,
    };
    let updateExpr = 'SET houseNumbers = :h, activityKey = :a, lastEditedAt = :at, lastEditedBy = :by';
    if (oldPriority !== null) updateExpr += ' REMOVE priority';

    await ddb.send(
      new UpdateCommand({
        TableName: tableName,
        Key: { PK: `PHOTO#${photoId}`, SK: 'META' },
        UpdateExpression: updateExpr,
        ExpressionAttributeValues: exprValues,
      }),
    );

    await ddb.send(
      new PutCommand({
        TableName: tableName,
        Item: {
          PK: `PHOTO#${photoId}`,
          SK: `AUDIT#${now}#section-moved`,
          entity: 'Audit',
          event: 'SectionMoved',
          at: now,
          by: callerEmail || callerSub,
          details: {
            from: { houseNumbers: oldHouseNumbers, activityKey: oldActivityKey, priority: oldPriority },
            to: { houseNumbers: [], activityKey, priority: null },
          },
        },
      }),
    );

    return json(200, { photoId, target: 'activity', activityKey, priority: null });
  }

  // target === 'other' — drop priority but keep existing houseNumbers /
  // activityKey untouched. Useful when the uploader wants to take a
  // house photo out of their book slots without re-tagging it as an
  // activity (e.g. it's a photo of their house that just shouldn't
  // compete for a slot this round).
  if (oldPriority === null) {
    return json(409, { error: 'Billedet er ikke i Mine Hus Billeder.' });
  }
  await ddb.send(
    new UpdateCommand({
      TableName: tableName,
      Key: { PK: `PHOTO#${photoId}`, SK: 'META' },
      UpdateExpression:
        'SET lastEditedAt = :at, lastEditedBy = :by REMOVE priority',
      ExpressionAttributeValues: {
        ':at': now,
        ':by': callerEmail || callerSub,
      },
    }),
  );
  await ddb.send(
    new PutCommand({
      TableName: tableName,
      Item: {
        PK: `PHOTO#${photoId}`,
        SK: `AUDIT#${now}#section-moved`,
        entity: 'Audit',
        event: 'SectionMoved',
        at: now,
        by: callerEmail || callerSub,
        details: {
          from: { houseNumbers: oldHouseNumbers, activityKey: oldActivityKey, priority: oldPriority },
          to: { houseNumbers: oldHouseNumbers, activityKey: oldActivityKey, priority: null },
        },
      },
    }),
  );

  return json(200, { photoId, target: 'other', priority: null });
};
