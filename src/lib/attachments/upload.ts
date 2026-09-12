import { ApiError, fetchJson } from '$lib/api/fetch-json';
import { ATTACHMENT_LIMITS, validateAttachment } from './limits';
// Type-only import: erased at build time, so no server code reaches the
// client bundle (see `$server/db/pg-attachments-schema.ts` for the source of
// truth on the 8 object types).
import type { AttachmentObjectType } from '$server/db/pg-attachments-schema';

export type { AttachmentObjectType };

export interface AttachmentObjectRef {
  objectType: AttachmentObjectType;
  objectId: string;
}

export interface AttachmentFile {
  id: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  createdAt: string;
}

export interface AttachmentWithLinks {
  file: AttachmentFile;
  links: AttachmentObjectRef[];
}

export type AttachmentErrorCode =
  | 'not_found'
  | 'upload_missing'
  | 'too_large'
  | 'mime_not_allowed'
  | 'quota_exceeded'
  | 'still_linked'
  | 'unknown';

/** Typed error for the upload flow — carries the server's `code` (or the
 *  client pre-check's own code) so the UI can render the right i18n message. */
export class AttachmentUploadError extends Error {
  constructor(
    public code: AttachmentErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'AttachmentUploadError';
  }
}

function toUploadError(e: unknown): AttachmentUploadError {
  if (e instanceof ApiError) {
    const code = (e.details as { code?: string } | undefined)?.code;
    return new AttachmentUploadError((code as AttachmentErrorCode) ?? 'unknown', e.message);
  }
  return new AttachmentUploadError('unknown', e instanceof Error ? e.message : String(e));
}

interface UploadIntent {
  fileId: string;
  key: string;
  uploadUrl: string;
  maxBytes: number;
}

export interface FinalizeResult {
  fileId: string;
  sizeBytes: number;
  links: AttachmentObjectRef[];
}

/** PUT with progress via XHR (fetch has no upload-progress event). */
function putWithProgress(
  url: string,
  file: File,
  onProgress?: (pct: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    xhr.setRequestHeader('Content-Type', file.type);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress?.(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new AttachmentUploadError('unknown', `upload failed (${xhr.status})`));
    };
    xhr.onerror = () => reject(new AttachmentUploadError('unknown', 'upload failed'));
    xhr.send(file);
  });
}

/** Presigned-PUT upload of one file, then link it to zero or more objects.
 *  Client-side pre-check mirrors the server's so obviously-bad files never
 *  reach the network; the server re-validates regardless (recon §4.3/§6.1 D3). */
export async function uploadAttachment(
  file: File,
  links: AttachmentObjectRef[],
  opts: { onProgress?: (pct: number) => void } = {},
): Promise<FinalizeResult> {
  const check = validateAttachment({
    fileName: file.name,
    contentType: file.type,
    sizeBytes: file.size,
  });
  if (!check.ok) throw new AttachmentUploadError(check.code, check.message);

  let intent: UploadIntent;
  try {
    intent = await fetchJson<UploadIntent>('/api/attachments/intent', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ fileName: file.name, contentType: file.type, sizeBytes: file.size }),
    });
  } catch (e) {
    throw toUploadError(e);
  }

  try {
    await putWithProgress(intent.uploadUrl, file, opts.onProgress);
  } catch (e) {
    // The browser-direct PUT needs bucket CORS for PUT from this origin. Until
    // that is provisioned (or when the network blocks it), fall back to the
    // server-proxied path for files under its cap, then link the result.
    // ponytail: fallback only for <= proxiedMaxBytes; larger files surface the error.
    await fetchJson(`/api/attachments/${intent.fileId}`, { method: 'DELETE' }).catch(() => {});
    if (file.size > ATTACHMENT_LIMITS.proxiedMaxBytes) throw e;
    return uploadViaProxy(file, links, opts.onProgress);
  }

  try {
    return await fetchJson<FinalizeResult>('/api/attachments/finalize', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ fileId: intent.fileId, links }),
    });
  } catch (e) {
    throw toUploadError(e);
  }
}

/** Server-proxied upload (`POST /api/files`, multipart, capped at
 *  `proxiedMaxBytes`) followed by one link call per object. */
async function uploadViaProxy(
  file: File,
  links: AttachmentObjectRef[],
  onProgress?: (pct: number) => void,
): Promise<FinalizeResult> {
  const form = new FormData();
  form.set('file', file);
  form.set('category', 'attachment');
  let id: string;
  try {
    ({ id } = await fetchJson<{ ok: true; id: string }>('/api/files', {
      method: 'POST',
      body: form,
    }));
  } catch (e) {
    throw toUploadError(e);
  }
  for (const ref of links) await linkAttachment(id, ref);
  onProgress?.(100);
  return { fileId: id, sizeBytes: file.size, links };
}

export async function listAttachments(
  objectType: AttachmentObjectType,
  objectId: string,
): Promise<AttachmentWithLinks[]> {
  const params = new URLSearchParams({ objectType, objectId });
  const { attachments } = await fetchJson<{ attachments: AttachmentWithLinks[] }>(
    `/api/attachments?${params}`,
  );
  return attachments;
}

export async function attachmentDownloadUrl(fileId: string): Promise<string> {
  const { url } = await fetchJson<{ url: string }>(`/api/attachments/${fileId}`);
  return url;
}

export async function linkAttachment(fileId: string, ref: AttachmentObjectRef): Promise<void> {
  await fetchJson(`/api/attachments/${fileId}/links`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(ref),
  });
}

export async function unlinkAttachment(fileId: string, ref: AttachmentObjectRef): Promise<void> {
  await fetchJson(`/api/attachments/${fileId}/links`, {
    method: 'DELETE',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(ref),
  });
}

/** `force` severs any remaining links too (caller confirms first — see
 *  `AttachmentList`'s "delete the file too?" prompt). */
export async function deleteAttachment(fileId: string, force = false): Promise<void> {
  await fetchJson(`/api/attachments/${fileId}${force ? '?force=1' : ''}`, { method: 'DELETE' });
}
