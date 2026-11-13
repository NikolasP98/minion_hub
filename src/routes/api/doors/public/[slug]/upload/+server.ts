import { json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { checkSharedRateLimit } from '$server/auth/shared-rate-limit';
import { uploadDoorFile } from '$server/services/doors-form.service';
import { ATTACHMENT_LIMITS } from '$lib/attachments/limits';
import { FORM_KEY_RE } from '$lib/doors/kinds/form';

// Unauthenticated file upload for a form door's `file` fields. The body is the raw file;
// the field key and file name travel in the query. No response, log line or error carries
// the file name or content.
// A site that posts from its own server shares one address, so this is per door, not per person.
const UPLOAD_LIMIT = 40;

const STATUS = {
  not_found: 404,
  invalid_field: 400,
  mime_not_allowed: 400,
  too_large: 413,
  quota_exceeded: 507,
} as const;

const fail = (status: number, code: string) => json({ error: code }, { status });

/** POST /api/doors/public/[slug]/upload?field=<key>&name=<file name> — body = the file. */
export const POST: RequestHandler = async (event) => {
  const { params, request, url } = event;
  let ip = 'unknown';
  try {
    ip = event.getClientAddress();
  } catch {
    // unavailable in some test/adapter contexts
  }
  if (!(await checkSharedRateLimit(`door-upload:${ip}:${params.slug}`, UPLOAD_LIMIT)))
    return fail(429, 'too_many');

  const field = url.searchParams.get('field') ?? '';
  const fileName = (url.searchParams.get('name') ?? '').slice(0, 500);
  if (!FORM_KEY_RE.test(field) || !fileName) return fail(400, 'invalid_field');
  // Refuse an oversized body before reading it; the service re-checks the real size.
  if (Number(request.headers.get('content-length') ?? 0) > ATTACHMENT_LIMITS.proxiedMaxBytes)
    return fail(413, 'too_large');

  let data: Uint8Array;
  try {
    data = new Uint8Array(await request.arrayBuffer());
  } catch {
    return fail(400, 'invalid_body');
  }
  if (!data.byteLength) return fail(400, 'invalid_body');

  try {
    const result = await uploadDoorFile(params.slug ?? '', {
      field,
      fileName,
      contentType: request.headers.get('content-type') ?? '',
      data,
    });
    if (result.status === 'ok') return json({ fileId: result.fileId });
    return fail(STATUS[result.status], result.status);
  } catch (e) {
    const code = (e as { code?: unknown; cause?: { code?: unknown } } | null) ?? {};
    console.error(
      '[doors] file upload failed',
      params.slug,
      code.code ?? code.cause?.code ?? 'error',
    );
    return fail(500, 'server_error');
  }
};
