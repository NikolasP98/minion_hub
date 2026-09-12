import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { getAuthorizedFileUrl, deleteAuthorizedFile } from '$server/services/file.service';
import { resolveAttachmentAccess } from '$server/services/attachment-access';
import { handleAttachmentError } from '../../attachments/_errors';
import { getCoreCtx } from '$server/auth/core-ctx';

export const GET: RequestHandler = async ({ locals, params }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);

  const access = await resolveAttachmentAccess(locals, ctx);
  try {
    const file = await getAuthorizedFileUrl(ctx, params.id!, access);
    return json({ file });
  } catch (e) {
    return handleAttachmentError(e);
  }
};

export const DELETE: RequestHandler = async ({ locals, params }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);

  const access = await resolveAttachmentAccess(locals, ctx);
  try {
    await deleteAuthorizedFile(ctx, params.id!, access);
    return json({ ok: true });
  } catch (e) {
    return handleAttachmentError(e);
  }
};
