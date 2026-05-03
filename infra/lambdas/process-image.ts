import type { S3Event, S3Handler } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { encode as encodeBlurhash } from 'blurhash';
import sharp from 'sharp';

const region = process.env.AWS_REGION ?? 'eu-west-1';
const tableName = process.env.TABLE_NAME!;
const originalsBucket = process.env.ORIGINALS_BUCKET!;
const derivedBucket = process.env.DERIVED_BUCKET!;

const s3 = new S3Client({ region });
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region }));

const WEB_MAX = 2400;
const THUMB_MAX = 400;
const BOOK_MAX = 3000;
const WEB_QUALITY = 85;
const THUMB_QUALITY = 80;
const BLURHASH_MAX = 32;
const ROTATED_ORIENTATIONS = new Set([5, 6, 7, 8]);

// Resolution gates. Long edge in pixels.
//   < MIN_LONG_EDGE        → Rejected (almost certainly a thumbnail/screenshot)
//   < BOOK_MIN_LONG_EDGE   → processed, but stamped with qualityWarning so the
//                            committee sees a "for lille til bog" chip in review.
const MIN_LONG_EDGE = 800;
const BOOK_MIN_LONG_EDGE = 1500;

// Target a book-export JPEG <2 MB. Start reasonably high and step down
// until we fit. Values chosen so even very large sources land in one or
// two iterations. Minimum quality 55 keeps print acceptable; if that
// still doesn't fit, we accept the slightly-over result (very rare).
const BOOK_TARGET_BYTES = 2 * 1000 * 1000; // 2,000,000 bytes ≈ 1.9 MiB
const BOOK_QUALITIES = [88, 82, 75, 68, 60, 55];

export const handler: S3Handler = async (event: S3Event) => {
  for (const record of event.Records) {
    const rawKey = record.s3.object.key;
    const key = decodeURIComponent(rawKey.replace(/\+/g, ' '));
    if (!key.startsWith('photos/')) {
      console.warn('skipping non-photo key', { key });
      continue;
    }
    const photoId = key.slice('photos/'.length).split('.')[0];
    try {
      await processOne(key, photoId);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('process-image failed', {
        key,
        photoId,
        error: message,
        stack: err instanceof Error ? err.stack : undefined,
      });
      await markFailed(photoId, message);
    }
  }
};

async function processOne(key: string, photoId: string): Promise<void> {
  const existing = await ddb.send(
    new GetCommand({ TableName: tableName, Key: { PK: `PHOTO#${photoId}`, SK: 'META' } }),
  );
  const row = existing.Item;
  if (!row) {
    console.warn('no DDB row for photo — orphan file?', { photoId, key });
    return;
  }
  if (row.status !== 'Uploaded') {
    console.info('photo already past Uploaded, skipping', { photoId, status: row.status });
    return;
  }

  const obj = await s3.send(new GetObjectCommand({ Bucket: originalsBucket, Key: key }));
  if (!obj.Body) throw new Error('empty S3 body');
  const buf = Buffer.from(await obj.Body.transformToByteArray());

  const meta = await sharp(buf, { failOn: 'none' }).metadata();
  const orientation = meta.orientation ?? 1;
  const rawW = meta.width ?? 0;
  const rawH = meta.height ?? 0;
  const displayW = ROTATED_ORIENTATIONS.has(orientation) ? rawH : rawW;
  const displayH = ROTATED_ORIENTATIONS.has(orientation) ? rawW : rawH;
  const longEdge = Math.max(displayW, displayH);

  if (longEdge > 0 && longEdge < MIN_LONG_EDGE) {
    await markRejected(photoId, displayW, displayH);
    return;
  }

  const qualityWarning =
    longEdge > 0 && longEdge < BOOK_MIN_LONG_EDGE ? 'low-resolution-for-book' : null;

  // sRGB pipeline: iPhone HEICs (and some modern cameras) ship in Display-P3.
  // toColorspace converts the working buffer; withIccProfile embeds the sRGB
  // profile so browsers and print pipelines render colors faithfully.
  const webBuf = await sharp(buf, { failOn: 'none' })
    .rotate()
    .resize({ width: WEB_MAX, height: WEB_MAX, fit: 'inside', withoutEnlargement: true })
    .toColorspace('srgb')
    .withIccProfile('srgb')
    .jpeg({ quality: WEB_QUALITY, mozjpeg: true })
    .toBuffer();

  const thumbBuf = await sharp(buf, { failOn: 'none' })
    .rotate()
    .resize({ width: THUMB_MAX, height: THUMB_MAX, fit: 'inside', withoutEnlargement: true })
    .toColorspace('srgb')
    .withIccProfile('srgb')
    .jpeg({ quality: THUMB_QUALITY, mozjpeg: true })
    .toBuffer();

  const { buffer: bookBuf, quality: bookQuality } = await encodeBookJpeg(buf);

  const { data: hashPixels, info: hashInfo } = await sharp(buf, { failOn: 'none' })
    .rotate()
    .resize({ width: BLURHASH_MAX, height: BLURHASH_MAX, fit: 'inside' })
    .toColorspace('srgb')
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const blurhash = encodeBlurhash(new Uint8ClampedArray(hashPixels), hashInfo.width, hashInfo.height, 4, 4);

  const webKey = `web/${photoId}.jpg`;
  const thumbKey = `thumb/${photoId}.jpg`;
  const bookKey = `book/${photoId}.jpg`;
  await Promise.all([
    s3.send(
      new PutObjectCommand({
        Bucket: derivedBucket,
        Key: webKey,
        Body: webBuf,
        ContentType: 'image/jpeg',
        CacheControl: 'public, max-age=31536000, immutable',
      }),
    ),
    s3.send(
      new PutObjectCommand({
        Bucket: derivedBucket,
        Key: thumbKey,
        Body: thumbBuf,
        ContentType: 'image/jpeg',
        CacheControl: 'public, max-age=31536000, immutable',
      }),
    ),
    s3.send(
      new PutObjectCommand({
        Bucket: derivedBucket,
        Key: bookKey,
        Body: bookBuf,
        ContentType: 'image/jpeg',
        CacheControl: 'public, max-age=31536000, immutable',
      }),
    ),
  ]);

  const processedAt = new Date().toISOString();
  await ddb.send(
    new UpdateCommand({
      TableName: tableName,
      Key: { PK: `PHOTO#${photoId}`, SK: 'META' },
      ConditionExpression: '#s = :uploaded',
      UpdateExpression:
        'SET #s = :inReview, derivedWebKey = :w, derivedThumbKey = :t, derivedBookKey = :bk, ' +
        'derivedBookBytes = :bb, derivedBookQuality = :bq, blurhash = :b, ' +
        'width = :ww, height = :hh, processedAt = :p, GSI1PK = :gpk, GSI1SK = :gsk, ' +
        'qualityWarning = :qw ' +
        'REMOVE processingError, processingErrorAt',
      ExpressionAttributeNames: { '#s': 'status' },
      ExpressionAttributeValues: {
        ':uploaded': 'Uploaded',
        ':inReview': 'In Review',
        ':w': webKey,
        ':t': thumbKey,
        ':bk': bookKey,
        ':bb': bookBuf.byteLength,
        ':bq': bookQuality,
        ':b': blurhash,
        ':ww': displayW,
        ':hh': displayH,
        ':p': processedAt,
        ':gpk': 'STATUS#In Review',
        ':gsk': `${processedAt}#${photoId}`,
        ':qw': qualityWarning,
      },
    }),
  );

  await ddb.send(
    new PutCommand({
      TableName: tableName,
      Item: {
        PK: `PHOTO#${photoId}`,
        SK: `AUDIT#${processedAt}#processed`,
        entity: 'Audit',
        event: 'Processed',
        from: 'Uploaded',
        to: 'In Review',
        at: processedAt,
        by: 'system:pipeline',
        details: {
          webKey,
          thumbKey,
          bookKey,
          bookBytes: bookBuf.byteLength,
          bookQuality,
          width: displayW,
          height: displayH,
          qualityWarning,
        },
      },
    }),
  );
}

async function markRejected(photoId: string, width: number, height: number): Promise<void> {
  const at = new Date().toISOString();
  const reason =
    `Billedet er for lille til at blive brugt (${width}×${height} pixel). ` +
    `Mindst ${MIN_LONG_EDGE} pixel på den længste side er nødvendigt — ` +
    `upload den originale version fra kameraet eller mobilen.`;
  // Condition guards against re-running the pipeline on a row that has already
  // moved past Uploaded (e.g. manual replay or duplicate S3 events).
  await ddb.send(
    new UpdateCommand({
      TableName: tableName,
      Key: { PK: `PHOTO#${photoId}`, SK: 'META' },
      ConditionExpression: '#s = :uploaded',
      UpdateExpression:
        'SET #s = :rejected, width = :ww, height = :hh, processingError = :e, processingErrorAt = :a',
      ExpressionAttributeNames: { '#s': 'status' },
      ExpressionAttributeValues: {
        ':uploaded': 'Uploaded',
        ':rejected': 'Rejected',
        ':ww': width,
        ':hh': height,
        ':e': reason,
        ':a': at,
      },
    }),
  );
  await ddb.send(
    new PutCommand({
      TableName: tableName,
      Item: {
        PK: `PHOTO#${photoId}`,
        SK: `AUDIT#${at}#rejected`,
        entity: 'Audit',
        event: 'Rejected',
        from: 'Uploaded',
        to: 'Rejected',
        at,
        by: 'system:pipeline',
        details: { width, height, reason: 'low-resolution', minLongEdge: MIN_LONG_EDGE },
      },
    }),
  );
}

async function encodeBookJpeg(source: Buffer): Promise<{ buffer: Buffer; quality: number }> {
  let last: { buffer: Buffer; quality: number } | null = null;
  for (const q of BOOK_QUALITIES) {
    // .rotate() applies EXIF orientation; sharp's default output strips EXIF
    // (including GPS), so the book JPEG is both correctly oriented and clean.
    // toColorspace + withIccProfile guarantee an sRGB-tagged file for print.
    const out = await sharp(source, { failOn: 'none' })
      .rotate()
      .resize({ width: BOOK_MAX, height: BOOK_MAX, fit: 'inside', withoutEnlargement: true })
      .toColorspace('srgb')
      .withIccProfile('srgb')
      .jpeg({ quality: q, mozjpeg: true, progressive: true })
      .toBuffer();
    last = { buffer: out, quality: q };
    if (out.byteLength <= BOOK_TARGET_BYTES) return last;
  }
  return last!;
}

async function markFailed(photoId: string, message: string): Promise<void> {
  try {
    await ddb.send(
      new UpdateCommand({
        TableName: tableName,
        Key: { PK: `PHOTO#${photoId}`, SK: 'META' },
        UpdateExpression: 'SET processingError = :e, processingErrorAt = :a',
        ExpressionAttributeValues: {
          ':e': message.slice(0, 500),
          ':a': new Date().toISOString(),
        },
      }),
    );
  } catch (err) {
    console.error('markFailed itself failed', err);
  }
}
