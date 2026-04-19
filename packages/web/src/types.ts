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
