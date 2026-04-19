export interface UploadMetadata {
  filename: string;
  contentType: string;
  description: string;
  whoInPhoto: string;
  year: number | null;
  yearApprox: boolean;
  houseNumbers: number[];
  consent: boolean;
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
}

export interface GalleryList {
  items: GalleryItem[];
  filters: { years: number[]; houses: number[] };
}

export interface GalleryDetail extends GalleryItem {
  visibilityBook: boolean;
  webUrl: string | null;
  downloadUrl: string | null;
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
