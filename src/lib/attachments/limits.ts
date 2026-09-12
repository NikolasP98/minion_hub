/**
 * Attachment upload limits (spec 2026-09-12-erp-core-modules-attachments-spec
 * §D). `maxFileBytes` gates the presigned (browser-direct) path; `proxiedMaxBytes`
 * gates the server-proxied `POST /api/files` path — Vercel's serverless request
 * body cap (~4.5 MB, undocumented in this repo, see recon §4.3) makes anything
 * above it presign-only. `orgQuotaBytes` is a soft per-tenant ceiling on
 * `sum(files.size_bytes)`. Env overrides are optional escape hatches, not
 * required.
 *
 * Client-safe: `$lib`, no `$server` imports. `readEnvBytes` guards `process`
 * with `typeof` so it never throws in the browser (env overrides only ever
 * apply server-side; the client always sees the shipped defaults).
 */
function readEnvBytes(key: string, fallback: number): number {
  const raw = typeof process !== 'undefined' ? process.env?.[key] : undefined;
  return Number(raw) || fallback;
}

export const ATTACHMENT_LIMITS = {
  maxFileBytes: readEnvBytes('ATTACHMENT_MAX_FILE_BYTES', 25 * 1024 * 1024),
  proxiedMaxBytes: readEnvBytes('ATTACHMENT_PROXIED_MAX_BYTES', 4 * 1024 * 1024),
  orgQuotaBytes: readEnvBytes('ATTACHMENT_ORG_QUOTA_BYTES', 2 * 1024 * 1024 * 1024),
};

export const ATTACHMENT_MIME_ALLOWLIST = new Set([
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'image/heic',
  'text/plain',
  'text/csv',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // docx
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // xlsx
  'application/vnd.openxmlformats-officedocument.presentationml.presentation', // pptx
  'application/msword', // doc
  'application/vnd.ms-excel', // xls
  'application/zip',
  'video/mp4',
  'audio/mpeg', // mp3
  'audio/mp4', // m4a
  'audio/x-m4a',
  'audio/wav',
]);

export type AttachmentValidationCode = 'too_large' | 'mime_not_allowed' | 'quota_exceeded';
export type AttachmentValidationResult =
  { ok: true } | { ok: false; code: AttachmentValidationCode; message: string };

/** Pure per-file cap + MIME allowlist check. `maxBytes` defaults to the
 *  presigned-path cap; the proxied route passes `proxiedMaxBytes` instead. */
export function validateAttachment(
  input: { fileName: string; contentType: string; sizeBytes: number },
  opts: { maxBytes?: number } = {},
): AttachmentValidationResult {
  const maxBytes = opts.maxBytes ?? ATTACHMENT_LIMITS.maxFileBytes;
  if (input.sizeBytes > maxBytes) {
    return { ok: false, code: 'too_large', message: `file exceeds ${maxBytes} bytes` };
  }
  if (!ATTACHMENT_MIME_ALLOWLIST.has(input.contentType)) {
    return {
      ok: false,
      code: 'mime_not_allowed',
      message: `unsupported content type: ${input.contentType}`,
    };
  }
  return { ok: true };
}
