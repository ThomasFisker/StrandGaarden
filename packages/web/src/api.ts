import type { MyPhoto, UploadMetadata, UploadUrlResponse } from './types';

const apiBase = import.meta.env.VITE_API_URL;
if (!apiBase) throw new Error('Missing VITE_API_URL');

const bearer = (idToken: string) => ({ Authorization: `Bearer ${idToken}` });

const jsonHeaders = (idToken: string) => ({
  ...bearer(idToken),
  'content-type': 'application/json',
});

const throwFromResponse = async (r: Response, scope: string): Promise<never> => {
  let detail = '';
  try {
    const body = await r.json();
    detail = body?.details?.join?.('; ') || body?.error || JSON.stringify(body);
  } catch {
    detail = await r.text();
  }
  throw new Error(`${scope} failed (HTTP ${r.status}): ${detail}`);
};

export const whoami = async (idToken: string): Promise<unknown> => {
  const r = await fetch(`${apiBase}/whoami`, { headers: bearer(idToken) });
  if (!r.ok) return throwFromResponse(r, 'whoami');
  return r.json();
};

export const requestUploadUrl = async (
  idToken: string,
  meta: UploadMetadata,
): Promise<UploadUrlResponse> => {
  const r = await fetch(`${apiBase}/upload-url`, {
    method: 'POST',
    headers: jsonHeaders(idToken),
    body: JSON.stringify(meta),
  });
  if (!r.ok) return throwFromResponse(r, 'upload-url');
  return r.json();
};

export const putToS3 = async (
  url: string,
  file: File,
  onProgress?: (fraction: number) => void,
): Promise<void> => {
  if (!onProgress) {
    const r = await fetch(url, { method: 'PUT', headers: { 'content-type': file.type }, body: file });
    if (!r.ok) throw new Error(`S3 PUT failed (HTTP ${r.status}): ${await r.text()}`);
    return;
  }
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    xhr.setRequestHeader('content-type', file.type);
    xhr.upload.onprogress = (ev) => {
      if (ev.lengthComputable) onProgress(ev.loaded / ev.total);
    };
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300
        ? resolve()
        : reject(new Error(`S3 PUT failed (HTTP ${xhr.status}): ${xhr.responseText}`));
    xhr.onerror = () => reject(new Error('S3 PUT network error'));
    xhr.send(file);
  });
};

export const getMyPhotos = async (idToken: string): Promise<MyPhoto[]> => {
  const r = await fetch(`${apiBase}/photos/mine`, { headers: bearer(idToken) });
  if (!r.ok) return throwFromResponse(r, 'photos/mine');
  const body = (await r.json()) as { items: MyPhoto[] };
  return body.items ?? [];
};
