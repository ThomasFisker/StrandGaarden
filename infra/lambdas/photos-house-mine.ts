import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, QueryCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { loadActivityNameMap } from './activities-shared';
import { PERSON_SK_PREFIX, PERSONLIST_PK } from './persons-shared';
import { json, USER_SK, userPk } from './users-shared';

const region = process.env.AWS_REGION ?? 'eu-west-1';
const tableName = process.env.TABLE_NAME!;
const derivedBucket = process.env.DERIVED_BUCKET!;
const THUMB_URL_TTL = 300;

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region }));
const s3 = new S3Client({ region });

interface PersonTag {
  slug: string;
  displayName: string;
  state: string;
}

const loadPersonMap = async (): Promise<Map<string, PersonTag>> => {
  const map = new Map<string, PersonTag>();
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
    for (const it of r.Items ?? []) {
      const slug = typeof it.slug === 'string' ? it.slug : '';
      if (!slug) continue;
      map.set(slug, {
        slug,
        displayName: String(it.displayName ?? slug),
        state: String(it.state ?? ''),
      });
    }
    ExclusiveStartKey = r.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return map;
};

/** GET /photos/house/mine — every Stage-1 priority photo in the caller's
 * assigned house, regardless of who uploaded it. Used to render the
 * "Mine Hus Billeder" tab so all members of a shared house see the
 * full ordering. Each row carries `isMine` so the SPA can render the
 * editor controls (arrows, edit button) only on the caller's own
 * uploads, and a `uploaderDisplayName` for the "Uploadet af X" byline
 * on cards belonging to other members.
 *
 * Returns `{ items: [] }` if the caller has no house assigned — the
 * SPA can still render the tab with an empty-state message. */
export const handler = async (event: APIGatewayProxyEventV2WithJWTAuthorizer) => {
  const claims = event.requestContext.authorizer?.jwt?.claims ?? {};
  const callerSub = typeof claims.sub === 'string' ? claims.sub : '';
  if (!callerSub) return json(401, { error: 'Unauthorized' });

  const userRow = await ddb.send(
    new GetCommand({ TableName: tableName, Key: { PK: userPk(callerSub), SK: USER_SK } }),
  );
  const myHouse =
    userRow.Item && typeof userRow.Item.houseNumber === 'number'
      ? (userRow.Item.houseNumber as number)
      : null;
  if (myHouse === null) {
    return json(200, { items: [], houseNumber: null });
  }

  const [personMap, activityMap] = await Promise.all([
    loadPersonMap(),
    loadActivityNameMap(ddb, tableName),
  ]);

  // Scan every PHOTO row tagged with the caller's house that carries a
  // priority slot. Priority slots are shared per house, so we don't
  // filter by uploaderSub here.
  const rawItems: Record<string, unknown>[] = [];
  let ExclusiveStartKey: Record<string, unknown> | undefined;
  do {
    const r = await ddb.send(
      new ScanCommand({
        TableName: tableName,
        FilterExpression:
          'entity = :p AND contains(houseNumbers, :h) AND attribute_exists(priority)',
        ExpressionAttributeValues: { ':p': 'Photo', ':h': myHouse },
        ExclusiveStartKey,
      }),
    );
    for (const it of r.Items ?? []) rawItems.push(it);
    ExclusiveStartKey = r.LastEvaluatedKey;
  } while (ExclusiveStartKey);

  const items = await Promise.all(
    rawItems.map(async (item) => {
      const derivedThumbKey =
        typeof item.derivedThumbKey === 'string' ? item.derivedThumbKey : null;
      const thumbnailUrl = derivedThumbKey
        ? await getSignedUrl(
            s3,
            new GetObjectCommand({ Bucket: derivedBucket, Key: derivedThumbKey }),
            { expiresIn: THUMB_URL_TTL },
          )
        : null;
      const uploaderSub = typeof item.uploaderSub === 'string' ? item.uploaderSub : '';
      const uploaderEmail = typeof item.uploaderEmail === 'string' ? item.uploaderEmail : '';
      const uploaderLoginName =
        typeof item.uploaderLoginName === 'string' ? item.uploaderLoginName : '';
      // Display name preference: loginName (preferred_username from
      // Cognito, stored at upload time) → email local-part → "ukendt".
      // Pre-existing rows uploaded before this lambda landed don't carry
      // loginName; the email fallback keeps them readable.
      const displayName = uploaderLoginName
        ? uploaderLoginName
        : uploaderEmail
          ? uploaderEmail.split('@')[0]
          : 'ukendt';
      return {
        photoId: String(item.photoId),
        shortId:
          item.shortId !== null && item.shortId !== undefined ? Number(item.shortId) : null,
        s3Key: String(item.s3Key),
        status: String(item.status),
        createdAt: String(item.createdAt),
        originalFilename: String(item.originalFilename ?? ''),
        contentType: String(item.contentType ?? ''),
        description: String(item.description ?? ''),
        year: item.year === null || item.year === undefined ? null : Number(item.year),
        yearApprox: item.yearApprox === true,
        houseNumbers: Array.isArray(item.houseNumbers) ? item.houseNumbers.map(Number) : [],
        visibilityWeb: item.visibilityWeb === true,
        visibilityBook: item.visibilityBook === true,
        width: item.width === null || item.width === undefined ? null : Number(item.width),
        height: item.height === null || item.height === undefined ? null : Number(item.height),
        blurhash: typeof item.blurhash === 'string' ? item.blurhash : null,
        thumbnailUrl,
        processingError:
          typeof item.processingError === 'string' ? item.processingError : null,
        qualityWarning:
          typeof item.qualityWarning === 'string' ? item.qualityWarning : null,
        persons: (Array.isArray(item.taggedPersonSlugs) ? (item.taggedPersonSlugs as string[]) : [])
          .map((slug) => personMap.get(slug))
          .filter((p): p is PersonTag => !!p),
        helpWanted: item.helpWanted === true,
        activityKey: typeof item.activityKey === 'string' ? item.activityKey : null,
        activityName:
          typeof item.activityKey === 'string'
            ? activityMap.get(item.activityKey) ?? null
            : null,
        priority: typeof item.priority === 'number' ? item.priority : null,
        isMine: uploaderSub === callerSub,
        uploaderDisplayName: displayName,
      };
    }),
  );

  items.sort((a, b) => (a.priority ?? 9999) - (b.priority ?? 9999));

  return json(200, { items, houseNumber: myHouse });
};
