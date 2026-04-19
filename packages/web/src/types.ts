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
  persons: PersonTag[];
}

export interface ReviewPhoto {
  photoId: string;
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
  persons: PersonTag[];
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
}

export interface GalleryPersonOption {
  slug: string;
  displayName: string;
}

export interface GalleryList {
  items: GalleryItem[];
  filters: { years: number[]; houses: number[]; persons: GalleryPersonOption[] };
}

export interface GalleryDetail extends GalleryItem {
  visibilityBook: boolean;
  webUrl: string | null;
  downloadUrl: string | null;
}

export type UserRole = 'admin' | 'member' | 'viewer';
export const USER_ROLES: UserRole[] = ['admin', 'member', 'viewer'];

export interface AdminUser {
  username: string;
  sub: string;
  email: string;
  status: string;
  enabled: boolean;
  createdAt: string | null;
  groups: string[];
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
