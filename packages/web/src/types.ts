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
}

export interface GalleryPersonOption {
  slug: string;
  displayName: string;
}

export interface GalleryList {
  items: GalleryItem[];
  filters: { years: number[]; houses: number[]; persons: GalleryPersonOption[] };
}

export interface AttributedAddendum {
  commentId: string;
  body: string;
  authorLoginName: string;
  createdAt: string;
}

export interface GalleryDetail extends GalleryItem {
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
export const HOUSES = Array.from({ length: 23 }, (_, i) => i + 1);

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
