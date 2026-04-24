import type {
  AdminCommentRow,
  AdminPerson,
  AdminRemovalRow,
  AdminUser,
  BookExportResponse,
  BookPhoto,
  DecisionResponse,
  GalleryDetail,
  GalleryList,
  MyPhoto,
  PersonTag,
  PersonTagInput,
  ReviewPhoto,
  UploadMetadata,
  UploadUrlResponse,
  UserRole,
} from './types';

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

export const getReviewQueue = async (idToken: string): Promise<ReviewPhoto[]> => {
  const r = await fetch(`${apiBase}/photos/review`, { headers: bearer(idToken) });
  if (!r.ok) return throwFromResponse(r, 'photos/review');
  const body = (await r.json()) as { items: ReviewPhoto[] };
  return body.items ?? [];
};

export const deletePhoto = async (idToken: string, photoId: string): Promise<void> => {
  const r = await fetch(`${apiBase}/photos/${encodeURIComponent(photoId)}`, {
    method: 'DELETE',
    headers: bearer(idToken),
  });
  if (!r.ok) return throwFromResponse(r, `photos/${photoId} DELETE`);
};

export interface PhotoEditPatch {
  description: string;
  whoInPhoto: string;
  year: number | null;
  yearApprox: boolean;
  houseNumbers: number[];
  taggedPersons: PersonTagInput[];
}

export const updatePhoto = async (
  idToken: string,
  photoId: string,
  patch: PhotoEditPatch,
): Promise<void> => {
  const r = await fetch(`${apiBase}/photos/${encodeURIComponent(photoId)}`, {
    method: 'PATCH',
    headers: jsonHeaders(idToken),
    body: JSON.stringify(patch),
  });
  if (!r.ok) return throwFromResponse(r, `photos/${photoId} PATCH`);
};

export const setHelpWanted = async (
  idToken: string,
  photoId: string,
  helpWanted: boolean,
): Promise<void> => {
  const r = await fetch(`${apiBase}/photos/${encodeURIComponent(photoId)}/help-wanted`, {
    method: 'PATCH',
    headers: jsonHeaders(idToken),
    body: JSON.stringify({ helpWanted }),
  });
  if (!r.ok) return throwFromResponse(r, `photos/${photoId}/help-wanted`);
};

export const decidePhoto = async (
  idToken: string,
  photoId: string,
  flags: { visibilityWeb: boolean; visibilityBook: boolean },
): Promise<DecisionResponse> => {
  const r = await fetch(`${apiBase}/photos/${encodeURIComponent(photoId)}/decision`, {
    method: 'PATCH',
    headers: jsonHeaders(idToken),
    body: JSON.stringify(flags),
  });
  if (!r.ok) return throwFromResponse(r, `decide ${photoId}`);
  return r.json();
};

export const getGallery = async (
  idToken: string,
  filters?: { year?: number | null; house?: number | null; person?: string | null },
): Promise<GalleryList> => {
  const qs = new URLSearchParams();
  if (filters?.year != null) qs.set('year', String(filters.year));
  if (filters?.house != null) qs.set('house', String(filters.house));
  if (filters?.person) qs.set('person', filters.person);
  const query = qs.toString();
  const url = query ? `${apiBase}/gallery?${query}` : `${apiBase}/gallery`;
  const r = await fetch(url, { headers: bearer(idToken) });
  if (!r.ok) return throwFromResponse(r, 'gallery');
  return r.json();
};

export const getGalleryPhoto = async (idToken: string, photoId: string): Promise<GalleryDetail> => {
  const r = await fetch(`${apiBase}/gallery/${encodeURIComponent(photoId)}`, { headers: bearer(idToken) });
  if (!r.ok) return throwFromResponse(r, `gallery/${photoId}`);
  return r.json();
};

export const postComment = async (
  idToken: string,
  photoId: string,
  body: string,
): Promise<{ commentId: string }> => {
  const r = await fetch(`${apiBase}/photos/${encodeURIComponent(photoId)}/comments`, {
    method: 'POST',
    headers: jsonHeaders(idToken),
    body: JSON.stringify({ body }),
  });
  if (!r.ok) return throwFromResponse(r, `photos/${photoId}/comments POST`);
  return r.json();
};

export const listPendingComments = async (idToken: string): Promise<AdminCommentRow[]> => {
  const r = await fetch(`${apiBase}/comments?status=pending`, { headers: bearer(idToken) });
  if (!r.ok) return throwFromResponse(r, 'comments pending');
  const b = (await r.json()) as { items: AdminCommentRow[] };
  return b.items ?? [];
};

export const mergeComment = async (
  idToken: string,
  photoId: string,
  commentId: string,
  input: { description: string; taggedPersons: PersonTagInput[]; keepAsAddendum: boolean },
): Promise<void> => {
  const r = await fetch(
    `${apiBase}/photos/${encodeURIComponent(photoId)}/comments/${encodeURIComponent(commentId)}/merge`,
    {
      method: 'POST',
      headers: jsonHeaders(idToken),
      body: JSON.stringify(input),
    },
  );
  if (!r.ok) return throwFromResponse(r, `merge comment ${commentId}`);
};

export const rejectComment = async (
  idToken: string,
  photoId: string,
  commentId: string,
): Promise<void> => {
  const r = await fetch(
    `${apiBase}/photos/${encodeURIComponent(photoId)}/comments/${encodeURIComponent(commentId)}`,
    { method: 'DELETE', headers: bearer(idToken) },
  );
  if (!r.ok && r.status !== 204) return throwFromResponse(r, `reject comment ${commentId}`);
};

export const postRemovalRequest = async (
  idToken: string,
  photoId: string,
  reason: string,
): Promise<{ removalId: string }> => {
  const r = await fetch(`${apiBase}/photos/${encodeURIComponent(photoId)}/removals`, {
    method: 'POST',
    headers: jsonHeaders(idToken),
    body: JSON.stringify({ reason }),
  });
  if (!r.ok) return throwFromResponse(r, `photos/${photoId}/removals POST`);
  return r.json();
};

export const listPendingRemovals = async (idToken: string): Promise<AdminRemovalRow[]> => {
  const r = await fetch(`${apiBase}/removals?status=pending`, { headers: bearer(idToken) });
  if (!r.ok) return throwFromResponse(r, 'removals pending');
  const b = (await r.json()) as { items: AdminRemovalRow[] };
  return b.items ?? [];
};

export const decideRemoval = async (
  idToken: string,
  photoId: string,
  removalId: string,
  input: { approved: boolean; note?: string },
): Promise<void> => {
  const r = await fetch(
    `${apiBase}/photos/${encodeURIComponent(photoId)}/removals/${encodeURIComponent(removalId)}/decide`,
    {
      method: 'POST',
      headers: jsonHeaders(idToken),
      body: JSON.stringify(input),
    },
  );
  if (!r.ok) return throwFromResponse(r, `decide removal ${removalId}`);
};

export const listBookPhotos = async (idToken: string): Promise<BookPhoto[]> => {
  const r = await fetch(`${apiBase}/book`, { headers: bearer(idToken) });
  if (!r.ok) return throwFromResponse(r, 'book');
  const b = (await r.json()) as { items: BookPhoto[] };
  return b.items ?? [];
};

export const exportBookZip = async (
  idToken: string,
  photoIds: string[],
): Promise<BookExportResponse> => {
  const r = await fetch(`${apiBase}/book/export`, {
    method: 'POST',
    headers: jsonHeaders(idToken),
    body: JSON.stringify({ photoIds }),
  });
  if (!r.ok) return throwFromResponse(r, 'book/export');
  return r.json();
};

export const listUsers = async (idToken: string): Promise<AdminUser[]> => {
  const r = await fetch(`${apiBase}/users`, { headers: bearer(idToken) });
  if (!r.ok) return throwFromResponse(r, 'users');
  const body = (await r.json()) as { items: AdminUser[] };
  return body.items ?? [];
};

export const createUser = async (
  idToken: string,
  input: { email: string; loginName: string; group: UserRole; initialPassword: string },
): Promise<{ username: string; email: string; loginName: string; group: UserRole }> => {
  const r = await fetch(`${apiBase}/users`, {
    method: 'POST',
    headers: jsonHeaders(idToken),
    body: JSON.stringify(input),
  });
  if (!r.ok) return throwFromResponse(r, 'users/create');
  return r.json();
};

export const updateUserGroup = async (
  idToken: string,
  username: string,
  group: UserRole,
): Promise<void> => {
  const r = await fetch(`${apiBase}/users/${encodeURIComponent(username)}/groups`, {
    method: 'PATCH',
    headers: jsonHeaders(idToken),
    body: JSON.stringify({ group }),
  });
  if (!r.ok) return throwFromResponse(r, `users/${username}/groups`);
};

export const updateUserLoginName = async (
  idToken: string,
  username: string,
  loginName: string,
): Promise<void> => {
  const r = await fetch(`${apiBase}/users/${encodeURIComponent(username)}/login-name`, {
    method: 'PATCH',
    headers: jsonHeaders(idToken),
    body: JSON.stringify({ loginName }),
  });
  if (!r.ok) return throwFromResponse(r, `users/${username}/login-name`);
};

export const resetUserPassword = async (
  idToken: string,
  username: string,
  newPassword: string,
): Promise<void> => {
  const r = await fetch(`${apiBase}/users/${encodeURIComponent(username)}/password`, {
    method: 'POST',
    headers: jsonHeaders(idToken),
    body: JSON.stringify({ newPassword }),
  });
  if (!r.ok) return throwFromResponse(r, `users/${username}/password`);
};

export const deleteUser = async (idToken: string, username: string): Promise<void> => {
  const r = await fetch(`${apiBase}/users/${encodeURIComponent(username)}`, {
    method: 'DELETE',
    headers: bearer(idToken),
  });
  if (!r.ok && r.status !== 204) return throwFromResponse(r, `users/${username}/delete`);
};

export const listPersons = async (idToken: string): Promise<{ items: AdminPerson[]; includeAll: boolean }> => {
  const r = await fetch(`${apiBase}/persons`, { headers: bearer(idToken) });
  if (!r.ok) return throwFromResponse(r, 'persons');
  return r.json();
};

export const createPerson = async (idToken: string, displayName: string): Promise<PersonTag> => {
  const r = await fetch(`${apiBase}/persons`, {
    method: 'POST',
    headers: jsonHeaders(idToken),
    body: JSON.stringify({ displayName }),
  });
  if (!r.ok) return throwFromResponse(r, 'persons/create');
  return r.json();
};

export const updatePerson = async (
  idToken: string,
  slug: string,
  patch: { displayName?: string; state?: 'approved' },
): Promise<PersonTag> => {
  const r = await fetch(`${apiBase}/persons/${encodeURIComponent(slug)}`, {
    method: 'PATCH',
    headers: jsonHeaders(idToken),
    body: JSON.stringify(patch),
  });
  if (!r.ok) return throwFromResponse(r, `persons/${slug}`);
  return r.json();
};

export const deletePerson = async (idToken: string, slug: string): Promise<void> => {
  const r = await fetch(`${apiBase}/persons/${encodeURIComponent(slug)}`, {
    method: 'DELETE',
    headers: bearer(idToken),
  });
  if (!r.ok && r.status !== 204) return throwFromResponse(r, `persons/${slug}/delete`);
};
