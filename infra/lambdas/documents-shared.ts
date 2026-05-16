/**
 * Shared bits for the documents feature.
 *
 * DDB layout (single table):
 *
 *   MEETING#<uuid> / META — a board meeting OR a general assembly
 *   DOC#<uuid> / META     — an uploaded document (PDF or DOCX)
 *   DOC#<uuid> / AUDIT#<iso>#<event> — per-document audit rows
 *   AUDIT / DOC#<id>#<iso>           — top-level audit row (GDPR-scope events)
 *
 * GSI1 partitions (sparse):
 *   GSI1PK = MEETING_LIST, GSI1SK = <date>#<meetingId>     — chronological meetings
 *   GSI1PK = DOC_LIST,     GSI1SK = <YYYY-MM-DD>#<docId>   — chronological docs
 */

export const MEETING_PK_PREFIX = 'MEETING#';
export const DOC_PK_PREFIX = 'DOC#';
export const META_SK = 'META';

export const MEETING_LIST_GSI1PK = 'MEETING_LIST';
export const DOC_LIST_GSI1PK = 'DOC_LIST';

export const meetingPk = (id: string): string => `${MEETING_PK_PREFIX}${id}`;
export const docPk = (id: string): string => `${DOC_PK_PREFIX}${id}`;

/** Meeting kind enum. `board` = bestyrelsesmøde; `assembly` =
 * generalforsamling (ordinær eller ekstraordinær — the title field
 * carries the distinction). */
export const MEETING_KINDS = ['board', 'assembly'] as const;
export type MeetingKind = (typeof MEETING_KINDS)[number];
export const isMeetingKind = (s: unknown): s is MeetingKind =>
  typeof s === 'string' && (MEETING_KINDS as readonly string[]).includes(s);

/** Categories are admin-managed via /bestyrelse/dokument-kategorier
 * (DDB partition `DOCCATEGORYLIST`). Validation lives in
 * `loadDocCategoryNames` from `doc-categories-shared.ts`. */
export type DocCategory = string;

/** MIME allowlist for document uploads. Separate from the photo
 * allowlist — do not merge them. */
export const ACCEPTED_DOC_CONTENT_TYPES: Record<string, string> = {
  'application/pdf': 'pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
};

export const DOC_MAX_BYTES = 25 * 1024 * 1024;
export const DOC_URL_TTL_SECONDS = 900; // 15 min, matches gallery-detail
export const DOC_UPLOAD_URL_TTL_SECONDS = 300; // 5 min for PUT

export const DOC_TITLE_MAX = 200;
export const DOC_NOTE_MAX = 500;
/** Long-form AI-generated description of the document's content. Set
 * by the bulk-import script (infra/scripts/import-documents.ts) or
 * optionally edited by bestyrelsen. Separate from `note` so a manual
 * comment doesn't clobber the auto-generated summary. Searchable. */
export const DOC_SUMMARY_MAX = 2000;
export const DOC_TAG_MAX = 50;
export const DOC_TAGS_MAX_COUNT = 10;
export const MEETING_TITLE_MAX = 200;
export const MEETING_DESCRIPTION_MAX = 1000;
export const FILENAME_MAX = 255;

/** ISO date string YYYY-MM-DD. */
export const isIsoDate = (s: unknown): s is string =>
  typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);

export const isPositiveInt = (n: unknown): n is number =>
  typeof n === 'number' && Number.isInteger(n) && n > 0;

/** Sanitise a filename for safe use in S3 keys + Content-Disposition.
 * Collapses whitespace, replaces path separators, trims, caps at
 * FILENAME_MAX. Browser file pickers won't surface control chars; we
 * don't need to strip them here. */
export const safeFilename = (raw: string): string =>
  raw.normalize('NFKC').replace(/[\\/]/g, '_').replace(/\s+/g, ' ').trim().slice(0, FILENAME_MAX);
