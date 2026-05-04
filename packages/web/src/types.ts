export type PersonState = 'approved' | 'pending';

export interface PersonTag {
  slug: string;
  displayName: string;
  state: PersonState | string;
}

export interface AdminPerson extends PersonTag {
  proposedBy: string | null;
  proposedByEmail: string | null;
  proposedAt: string | null;
  approvedAt: string | null;
}

/** Entries in UploadMetadata.taggedPersons: either a reference by slug or a
 * new display name the server should create as a pending proposal. */
export type PersonTagInput =
  | { slug: string; proposedName?: never }
  | { proposedName: string; slug?: never };

export interface UploadMetadata {
  filename: string;
  contentType: string;
  description: string;
  whoInPhoto: string;
  year: number | null;
  yearApprox: boolean;
  houseNumbers: number[];
  /** Stage-1 alternative to a house: the photo belongs to a club-wide
   * activity (Sankt Hans, Generalforsamling, …). When set, houseNumbers
   * is empty. Ignored outside Stage 1. */
  activityKey?: string | null;
  consent: boolean;
  taggedPersons: PersonTagInput[];
  helpWanted: boolean;
}

export interface UploadUrlResponse {
  photoId: string;
  uploadUrl: string;
  expiresIn: number;
  maxBytes: number;
  s3Key: string;
}

export interface MyPhoto {
  photoId: string;
  shortId: number | null;
  s3Key: string;
  status: string;
  createdAt: string;
  originalFilename: string;
  contentType: string;
  description: string;
  whoInPhoto: string;
  year: number | null;
  yearApprox: boolean;
  houseNumbers: number[];
  visibilityWeb: boolean;
  visibilityBook: boolean;
  width: number | null;
  height: number | null;
  blurhash: string | null;
  thumbnailUrl: string | null;
  processingError: string | null;
  qualityWarning: string | null;
  persons: PersonTag[];
  helpWanted: boolean;
  activityKey: string | null;
  activityName: string | null;
  /** Stage-1 ranking the uploader sets via the up/down arrows on /mine.
   * Number 1..maxBookSlotsPerHouse for the uploader's own house photos;
   * null for activity photos and pre-stage-1 uploads. */
  priority: number | null;
}

export interface ReviewPhoto {
  photoId: string;
  shortId: number | null;
  status: string;
  createdAt: string;
  processedAt: string | null;
  originalFilename: string;
  description: string;
  whoInPhoto: string;
  year: number | null;
  yearApprox: boolean;
  houseNumbers: number[];
  uploaderEmail: string | null;
  width: number | null;
  height: number | null;
  visibilityWeb: boolean;
  visibilityBook: boolean;
  thumbnailUrl: string | null;
  webUrl: string | null;
  qualityWarning: string | null;
  persons: PersonTag[];
  helpWanted: boolean;
  activityKey: string | null;
  activityName: string | null;
}

export interface DecisionResponse {
  photoId: string;
  status: string;
  visibilityWeb: boolean;
  visibilityBook: boolean;
  decidedAt: string;
  decidedBy: string;
}

export interface GalleryItem {
  photoId: string;
  shortId: number | null;
  description: string;
  whoInPhoto: string;
  year: number | null;
  yearApprox: boolean;
  houseNumbers: number[];
  width: number | null;
  height: number | null;
  blurhash: string | null;
  thumbnailUrl: string | null;
  persons: PersonTag[];
  helpWanted: boolean;
  activityKey: string | null;
  activityName: string | null;
  /** Only populated in the admin "show all" listing. Undefined for the
   * public listing (where every item is web-visible by definition). */
  visibilityWeb?: boolean;
  visibilityBook?: boolean;
}

export interface GalleryPersonOption {
  slug: string;
  displayName: string;
}

export interface GalleryActivityOption {
  key: string;
  displayName: string;
}

export interface GalleryList {
  items: GalleryItem[];
  filters: {
    years: number[];
    houses: number[];
    persons: GalleryPersonOption[];
    activities: GalleryActivityOption[];
  };
  showAll?: boolean;
}

export interface AttributedAddendum {
  commentId: string;
  body: string;
  authorLoginName: string;
  createdAt: string;
}

export interface GalleryDetail extends GalleryItem {
  visibilityWeb: boolean;
  visibilityBook: boolean;
  webUrl: string | null;
  downloadUrl: string | null;
  approvedComments: AttributedAddendum[];
}

export interface AdminRemovalRow {
  removalId: string;
  photoId: string;
  photoShortId: number | null;
  photoExists: boolean;
  photoDescription: string;
  photoYear: number | null;
  photoYearApprox: boolean;
  photoHouseNumbers: number[];
  reason: string;
  requestorLoginName: string;
  requestorEmail: string;
  requestorRole: string;
  createdAt: string;
  thumbnailUrl: string | null;
}

export interface AdminCommentRow {
  commentId: string;
  photoId: string;
  photoShortId: number | null;
  body: string;
  authorLoginName: string;
  authorEmail: string;
  authorRole: string;
  createdAt: string;
  thumbnailUrl: string | null;
  photoDescription: string;
  photoPersonSlugs: string[];
  photoYear: number | null;
  photoYearApprox: boolean;
  photoHouseNumbers: number[];
}

export interface BookPhoto {
  photoId: string;
  shortId: number | null;
  description: string;
  whoInPhoto: string;
  year: number | null;
  yearApprox: boolean;
  houseNumbers: number[];
  originalFilename: string;
  bookBytes: number | null;
  bookReady: boolean;
  thumbnailUrl: string | null;
  bookUrl: string | null;
  persons: PersonTag[];
  activityKey: string | null;
  activityName: string | null;
}

export interface BookExportResponse {
  exportId: string;
  photoCount: number;
  downloadUrl: string;
  expiresInSeconds: number;
}

export type UserRole = 'admin' | 'member' | 'viewer';
export const USER_ROLES: UserRole[] = ['admin', 'member', 'viewer'];

export interface AdminUser {
  username: string;
  sub: string;
  email: string;
  loginName: string;
  status: string;
  enabled: boolean;
  createdAt: string | null;
  groups: string[];
  houseNumber: number | null;
  gdprAcceptedAt: string | null;
  gdprAcceptedVersion: string | null;
}

/** Stage of the public release lifecycle. Driven by the singleton CONFIG row.
 * 1 = book-collection mode, 2 = freeze, 3 = open gallery (today's behavior). */
export type Stage = 1 | 2 | 3;

export interface AppConfig {
  stage: Stage;
  maxBookSlotsPerHouse: number;
  maxHouseTextChars: number;
  gdprText: string;
  gdprVersion: string;
}

export interface Activity {
  key: string;
  displayName: string;
  displayOrder: number;
  createdAt: string | null;
  createdBy: string | null;
}

/** The caller's own profile, returned by GET /me. Used to prefill the
 * uploader's assigned house, gate the GDPR consent flow, and react to
 * the current stage (banner + freeze of write forms). */
export interface MyProfile {
  sub: string;
  email: string | null;
  loginName: string | null;
  groups: string[];
  houseNumber: number | null;
  gdprAcceptedAt: string | null;
  gdprAcceptedVersion: string | null;
  gdprCurrentVersion: string;
  gdprNeedsAcceptance: boolean;
  stage: Stage;
  /** Per-house cap from CONFIG. Always present so the form can render
   * "X of Y" copy regardless of stage. */
  maxBookSlotsPerHouse: number;
  /** How many photos in the archive carry the user's assigned house.
   * Computed only when stage=1 and the user has a house — null
   * otherwise (we skip the scan in Stage 3 to keep /me cheap). */
  myHouseSlotsUsed: number | null;
  /** Char limit for the house-text editor on /mine. */
  maxHouseTextChars: number;
  /** Caller's house chapter-intro text. null when the user has no
   * house assigned, or when the row hasn't been written yet. */
  myHouseText: string | null;
  /** Has the user been shown the optional "set your own password" prompt
   * after first login? Once true, the prompt is suppressed forever. */
  firstLoginAcked: boolean;
}

export interface AdminHouseTextRow {
  houseNumber: number;
  body: string | null;
  lastEditedAt: string | null;
  lastEditedBy: string | null;
  lastEditedByLoginName: string | null;
  lastEditedByEmail: string | null;
}

export interface GdprText {
  version: string;
  text: string;
}

export const ACCEPTED_MIME: Record<string, string> = {
  'image/jpeg': 'JPEG',
  'image/png': 'PNG',
  'image/tiff': 'TIFF',
  'image/heic': 'HEIC',
  'image/heif': 'HEIF',
};

export const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;

/** Valid Strandgaarden house numbers — odds 3..17, then evens 4..32.
 * This is the canonical UI display order; the backend's VALID_HOUSES in
 * infra/lambdas/users-shared.ts must be kept in sync (the two lists are
 * intentionally duplicated since infra and web are separate workspaces).
 */
export const HOUSES: readonly number[] = [
  3, 5, 7, 9, 11, 13, 15, 17,
  4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24, 26, 28, 30, 32,
];

/** Resolution gates — must stay in sync with `MIN_LONG_EDGE` /
 * `BOOK_MIN_LONG_EDGE` in `infra/lambdas/process-image.ts`. The server is
 * authoritative; these constants are only used for client-side pre-checks
 * on JPEG/PNG (HEIC can't be decoded in the browser without a heavy WASM
 * library, so HEIC always relies on the server check). */
export const MIN_LONG_EDGE = 800;
export const BOOK_MIN_LONG_EDGE = 1500;

/** Human-readable short ID like "ID-00042". Used when referring to a photo
 * verbally or in chat — easier than a UUID. */
export const formatShortId = (n: number | null | undefined): string =>
  n === null || n === undefined ? 'ID-?????' : `ID-${String(n).padStart(5, '0')}`;
