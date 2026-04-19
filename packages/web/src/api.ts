const apiBase = import.meta.env.VITE_API_URL;
if (!apiBase) throw new Error('Missing VITE_API_URL');

export const whoami = async (idToken: string): Promise<unknown> => {
  const r = await fetch(`${apiBase}/whoami`, {
    headers: { Authorization: `Bearer ${idToken}` },
  });
  if (!r.ok) throw new Error(`whoami failed: ${r.status} ${await r.text()}`);
  return r.json();
};

export interface UploadUrlResponse {
  photoId: string;
  uploadUrl: string;
  expiresIn: number;
  maxBytes: number;
  s3Key: string;
}

export const requestUploadUrl = async (
  idToken: string,
  filename: string,
  contentType: string,
): Promise<UploadUrlResponse> => {
  const r = await fetch(`${apiBase}/upload-url`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${idToken}`, 'content-type': 'application/json' },
    body: JSON.stringify({ filename, contentType }),
  });
  if (!r.ok) throw new Error(`upload-url failed: ${r.status} ${await r.text()}`);
  return r.json();
};

export const putToS3 = async (url: string, file: File): Promise<void> => {
  const r = await fetch(url, {
    method: 'PUT',
    headers: { 'content-type': file.type },
    body: file,
  });
  if (!r.ok) throw new Error(`S3 PUT failed: ${r.status} ${await r.text()}`);
};
