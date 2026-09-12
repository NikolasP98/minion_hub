import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { z } from 'zod';
import { getCoreCtx } from '$server/auth/core-ctx';
import { parseBody } from '$server/api/validate';
import { linkAttachment, unlinkAttachment } from '$server/services/attachments.service';
import { ATTACHMENT_OBJECT_TYPES } from '$server/db/pg-attachments-schema';
import { handleAttachmentError } from '../../_errors';
import { assertCanEditLinks } from '../../_guard';

const linkSchema = z.object({
  objectType: z.enum(ATTACHMENT_OBJECT_TYPES),
  objectId: z.string().uuid(),
});

function actorOf(locals: App.Locals, ctx: { profileId?: string }) {
  return {
    id: ctx.profileId ?? null,
    name: locals.user?.displayName ?? locals.user?.email ?? null,
  };
}

/** POST /api/attachments/[fileId]/links — link this file to another object
 *  (idempotent upsert on the objectType/objectId/fileId primary key). */
export const POST: RequestHandler = async ({ locals, request, params }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  const body = await parseBody(request, linkSchema);
  await assertCanEditLinks(locals, [body]);
  try {
    await linkAttachment(ctx, { fileId: params.fileId!, ...body, actor: actorOf(locals, ctx) });
    return json({ ok: true });
  } catch (e) {
    return handleAttachmentError(e);
  }
};

/** DELETE /api/attachments/[fileId]/links — unlink this file from one object. */
export const DELETE: RequestHandler = async ({ locals, request, params }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  const body = await parseBody(request, linkSchema);
  await assertCanEditLinks(locals, [body]);
  try {
    await unlinkAttachment(ctx, { fileId: params.fileId!, ...body, actor: actorOf(locals, ctx) });
    return json({ ok: true });
  } catch (e) {
    return handleAttachmentError(e);
  }
};
