import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { getCoreCtx } from '$server/auth/core-ctx';
import { getAttachmentDownloadUrl, deleteAttachment } from '$server/services/attachments.service';
import { getAttachmentAccess } from '../_guard';
import { handleAttachmentError } from '../_errors';

/** GET /api/attachments/[fileId] — presigned download url. */
export const GET: RequestHandler = async ({ locals, params }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  const access = await getAttachmentAccess(locals, ctx);
  try {
    const result = await getAttachmentDownloadUrl(ctx, params.fileId!, access);
    return json(result);
  } catch (e) {
    return handleAttachmentError(e);
  }
};

/** DELETE /api/attachments/[fileId]?force=1 — refuses (409 still_linked)
 *  while any link remains, unless `force`. */
export const DELETE: RequestHandler = async ({ locals, params, url }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  const force = url.searchParams.get('force') === '1';
  try {
    const access = await getAttachmentAccess(locals, ctx, 'edit');
    await deleteAttachment(ctx, params.fileId!, access, { force });
    return json({ ok: true });
  } catch (e) {
    return handleAttachmentError(e);
  }
};
