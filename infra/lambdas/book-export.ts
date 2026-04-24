import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';
import { randomUUID } from 'node:crypto';
import { PassThrough } from 'node:stream';
import archiver from 'archiver';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, BatchGetCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Upload } from '@aws-sdk/lib-storage';
import { PERSON_SK_PREFIX, PERSONLIST_PK } from './persons-shared';

const region = process.env.AWS_REGION ?? 'eu-west-1';
const tableName = process.env.TABLE_NAME!;
const derivedBucket = process.env.DERIVED_BUCKET!;
const URL_TTL = 7 * 24 * 3600; // 7 days — same as the exports/ lifecycle

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region }));
const s3 = new S3Client({ region });

const json = (statusCode: number, body: unknown) => ({
  statusCode,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

const parseGroups = (raw: unknown): string[] => {
  if (Array.isArray(raw)) return raw.map(String);
  if (typeof raw === 'string') return raw.replace(/^\[|\]$/g, '').split(/[\s,]+/).filter(Boolean);
  return [];
};

const formatShortId = (n: number | null): string =>
  n === null ? 'ID-?????' : `ID-${String(n).padStart(5, '0')}`;

const csvEscape = (s: string): string => {
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
};

interface PersonTag { slug: string; displayName: string; }
interface PhotoRow {
  photoId: string;
  shortId: number | null;
  description: string;
  whoInPhoto: string;
  year: number | null;
  yearApprox: boolean;
  houseNumbers: number[];
  originalFilename: string;
  uploaderEmail: string;
  bookKey: string | null;
  persons: PersonTag[];
}

const loadPersonMap = async (): Promise<Map<string, string>> => {
  const map = new Map<string, string>();
  let esk: Record<string, unknown> | undefined;
  do {
    const p = await ddb.send(
      new QueryCommand({
        TableName: tableName,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
        ExpressionAttributeValues: { ':pk': PERSONLIST_PK, ':sk': PERSON_SK_PREFIX },
        ExclusiveStartKey: esk,
      }),
    );
    for (const it of p.Items ?? []) {
      const slug = typeof it.slug === 'string' ? it.slug : '';
      if (slug) map.set(slug, String(it.displayName ?? slug));
    }
    esk = p.LastEvaluatedKey;
  } while (esk);
  return map;
};

const fetchPhotos = async (photoIds: string[]): Promise<PhotoRow[]> => {
  const personMap = await loadPersonMap();
  const rows: PhotoRow[] = [];

  // BatchGetItem is capped at 100 keys per call.
  for (let i = 0; i < photoIds.length; i += 100) {
    const chunk = photoIds.slice(i, i + 100);
    const keys = chunk.map((id) => ({ PK: `PHOTO#${id}`, SK: 'META' }));
    let remainingKeys: { PK: string; SK: string }[] = keys;
    let attempts = 0;
    while (remainingKeys.length > 0 && attempts < 6) {
      attempts += 1;
      const r = await ddb.send(
        new BatchGetCommand({ RequestItems: { [tableName]: { Keys: remainingKeys } } }),
      );
      for (const it of r.Responses?.[tableName] ?? []) {
        const slugs = Array.isArray(it.taggedPersonSlugs) ? (it.taggedPersonSlugs as string[]) : [];
        rows.push({
          photoId: String(it.photoId),
          shortId: it.shortId === null || it.shortId === undefined ? null : Number(it.shortId),
          description: String(it.description ?? ''),
          whoInPhoto: String(it.whoInPhoto ?? ''),
          year: it.year === null || it.year === undefined ? null : Number(it.year),
          yearApprox: it.yearApprox === true,
          houseNumbers: Array.isArray(it.houseNumbers) ? it.houseNumbers.map(Number) : [],
          originalFilename: String(it.originalFilename ?? ''),
          uploaderEmail: String(it.uploaderEmail ?? ''),
          bookKey: typeof it.derivedBookKey === 'string' ? it.derivedBookKey : null,
          persons: slugs
            .map((s) => (personMap.has(s) ? { slug: s, displayName: personMap.get(s)! } : null))
            .filter((p): p is PersonTag => !!p),
        });
      }
      const unprocessed = r.UnprocessedKeys?.[tableName]?.Keys as { PK: string; SK: string }[] | undefined;
      remainingKeys = unprocessed ?? [];
    }
  }

  rows.sort((a, b) => {
    const sa = a.shortId === null ? 9_999_999 : a.shortId;
    const sb = b.shortId === null ? 9_999_999 : b.shortId;
    return sa - sb;
  });
  return rows;
};

const yearLabel = (r: PhotoRow): string =>
  r.year === null ? 'ukendt' : r.yearApprox ? `ca. ${r.year}` : String(r.year);

const sidecarText = (r: PhotoRow): string => {
  const lines: string[] = [];
  lines.push(formatShortId(r.shortId));
  lines.push('');
  lines.push(`År:            ${yearLabel(r)}`);
  lines.push(`Hus:           ${r.houseNumbers.length > 0 ? r.houseNumbers.join(', ') : 'ukendt'}`);
  lines.push(`Originalfil:   ${r.originalFilename || '(ingen)'}`);
  if (r.uploaderEmail) lines.push(`Indsendt af:   ${r.uploaderEmail}`);
  lines.push('');
  lines.push('Beskrivelse');
  lines.push('-----------');
  lines.push(r.description || '(ingen beskrivelse)');
  if (r.whoInPhoto) {
    lines.push('');
    lines.push('Hvem er på billedet (fritekst)');
    lines.push('------------------------------');
    lines.push(r.whoInPhoto);
  }
  if (r.persons.length > 0) {
    lines.push('');
    lines.push('Personer (godkendt)');
    lines.push('-------------------');
    for (const p of r.persons) lines.push(`- ${p.displayName}`);
  }
  lines.push('');
  return lines.join('\r\n');
};

const indexCsv = (rows: PhotoRow[]): string => {
  const header = ['short_id', 'photo_id', 'year', 'year_approx', 'houses', 'persons', 'description', 'original_filename'];
  const out: string[] = [header.join(',')];
  for (const r of rows) {
    out.push(
      [
        formatShortId(r.shortId),
        r.photoId,
        r.year === null ? '' : String(r.year),
        r.yearApprox ? 'true' : 'false',
        r.houseNumbers.join(';'),
        r.persons.map((p) => p.displayName).join(';'),
        r.description.replace(/\r?\n/g, ' ').trim(),
        r.originalFilename,
      ]
        .map(csvEscape)
        .join(','),
    );
  }
  return '\uFEFF' + out.join('\r\n') + '\r\n'; // BOM so Excel opens as UTF-8
};

export const handler = async (event: APIGatewayProxyEventV2WithJWTAuthorizer) => {
  const claims = event.requestContext.authorizer?.jwt?.claims ?? {};
  const groups = parseGroups(claims['cognito:groups']);
  if (!groups.includes('admin')) return json(403, { error: 'Book export is restricted to admins' });

  let body: { photoIds?: unknown };
  try {
    body = JSON.parse(event.body ?? '{}');
  } catch {
    return json(400, { error: 'Request body must be valid JSON' });
  }
  if (!Array.isArray(body.photoIds) || body.photoIds.length === 0) {
    return json(400, { error: 'photoIds must be a non-empty array' });
  }
  if (body.photoIds.length > 500) {
    return json(400, { error: 'Maximum 500 photos per export' });
  }
  const photoIds: string[] = [];
  for (const raw of body.photoIds) {
    if (typeof raw !== 'string' || !/^[0-9a-f-]{36}$/.test(raw)) {
      return json(400, { error: `Invalid photoId: ${String(raw).slice(0, 60)}` });
    }
    photoIds.push(raw);
  }

  const rows = await fetchPhotos(photoIds);
  if (rows.length === 0) return json(404, { error: 'No matching photos found' });

  const missingBook = rows.filter((r) => !r.bookKey).map((r) => formatShortId(r.shortId));
  if (missingBook.length > 0) {
    return json(409, {
      error: 'Some photos have no book derivative yet — process the photo again before exporting',
      details: missingBook,
    });
  }

  const exportId = randomUUID();
  const exportKey = `exports/${exportId}.zip`;
  const zipStream = new PassThrough();

  const archive = archiver('zip', { zlib: { level: 1 } }); // images are already JPEG — skip heavy compression
  archive.on('warning', (err) => console.warn('archiver warning', err));
  archive.on('error', (err) => {
    console.error('archiver error', err);
    zipStream.destroy(err);
  });
  archive.pipe(zipStream);

  // Kick off the S3 multipart upload in parallel; it consumes zipStream.
  const upload = new Upload({
    client: s3,
    params: {
      Bucket: derivedBucket,
      Key: exportKey,
      Body: zipStream,
      ContentType: 'application/zip',
      ContentDisposition: `attachment; filename="strandgaarden-bog-${exportId.slice(0, 8)}.zip"`,
    },
  });
  const uploadPromise = upload.done();

  // One photo in RAM at a time (~2 MB) — safe even with memorySize=1024.
  for (const r of rows) {
    const label = formatShortId(r.shortId);
    const obj = await s3.send(new GetObjectCommand({ Bucket: derivedBucket, Key: r.bookKey! }));
    if (!obj.Body) throw new Error(`S3 GetObject returned empty body for ${r.bookKey}`);
    const bytes = Buffer.from(await obj.Body.transformToByteArray());
    archive.append(bytes, { name: `${label}.jpg` });
    archive.append(Buffer.from(sidecarText(r), 'utf8'), { name: `${label}.txt` });
  }
  archive.append(indexCsv(rows), { name: 'index.csv' });

  await archive.finalize();
  await uploadPromise;

  const downloadUrl = await getSignedUrl(
    s3,
    new GetObjectCommand({
      Bucket: derivedBucket,
      Key: exportKey,
      ResponseContentDisposition: `attachment; filename="strandgaarden-bog-${exportId.slice(0, 8)}.zip"`,
    }),
    { expiresIn: URL_TTL },
  );

  return json(200, {
    exportId,
    photoCount: rows.length,
    downloadUrl,
    expiresInSeconds: URL_TTL,
  });
};
