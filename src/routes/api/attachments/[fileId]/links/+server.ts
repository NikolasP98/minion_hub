import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { z } from 'zod';
import { getCoreCtx } from '$server/auth/core-ctx';
import { parseBody } from '$server/api/validate';
import {
  linkAttachment,
  restoreAttachmentLink,
  unlinkAttachment,
} from '$server/services/attachments.service';
import { ATTACHMENT_OBJECT_TYPES } from '$server/db/pg-attachments-schema';
import { handleAttachmentError } from '../../_errors';
import { getAttachmentAccess } from '../../_guard';

const linkSchema = z.object({
  objectType: z.enum(ATTACHMENT_OBJECT_TYPES),
  objectId: z.string().uuid(),
  /** Move a hidden link back out of the trash instead of creating a new one. */
  restore: z.boolean().optional(),
});

function actorOf(locals: App.Locals, ctx: { profileId?: string }) {
  return {
    id: ctx.profileId ?? null,
    name: locals.user?.displayName ?? locals.user?.email ?? null,
  };
}

/** POST /api/attachments/[fileId]/links — link this file to another object
 *  (idempotent upsert on the objectType/objectId/fileId primary key), or with
 *  `restore: true` bring a hidden link back from the trash. */
export const POST: RequestHandler = async ({ locals, request, params }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  const { restore, ...body } = await parseBody(request, linkSchema);
  const access = await getAttachmentAccess(locals, ctx, 'edit');
  try {
    const input = { fileId: params.fileId!, ...body, actor: actorOf(locals, ctx) };
    if (restore) await restoreAttachmentLink(ctx, input, access);
    else await linkAttachment(ctx, input, access);
    return json({ ok: true });
  } catch (e) {
    return handleAttachmentError(e);
  }
};

/** DELETE /api/attachments/[fileId]/links — hide this file's link to one object
 *  (moves to the trash; restorable for 30 days via POST `restore: true`). */
export const DELETE: RequestHandler = async ({ locals, request, params }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  const { restore: _restore, ...body } = await parseBody(request, linkSchema);
  const access = await getAttachmentAccess(locals, ctx, 'edit');
  try {
    await unlinkAttachment(
      ctx,
      { fileId: params.fileId!, ...body, actor: actorOf(locals, ctx) },
      access,
    );
    return json({ ok: true });
  } catch (e) {
    return handleAttachmentError(e);
  }
};
