import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { z } from 'zod';
import { getCoreCtx } from '$server/auth/core-ctx';
import { parseBody } from '$server/api/validate';
import { finalizeUpload } from '$server/services/attachments.service';
import { ATTACHMENT_OBJECT_TYPES } from '$server/db/pg-attachments-schema';
import { handleAttachmentError } from '../_errors';
import { assertCanEditLinks } from '../_guard';

const finalizeSchema = z.object({
  fileId: z.string().min(1).max(200),
  links: z
    .array(z.object({ objectType: z.enum(ATTACHMENT_OBJECT_TYPES), objectId: z.string().uuid() }))
    .optional(),
});

/** POST /api/attachments/finalize — confirm the presigned PUT landed and
 *  create any requested links. */
export const POST: RequestHandler = async ({ locals, request }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);

  const body = await parseBody(request, finalizeSchema);
  await assertCanEditLinks(locals, body.links ?? []);
  try {
    const result = await finalizeUpload(ctx, {
      fileId: body.fileId,
      links: body.links,
      actor: {
        id: ctx.profileId ?? null,
        name: locals.user?.displayName ?? locals.user?.email ?? null,
      },
    });
    return json(result);
  } catch (e) {
    return handleAttachmentError(e);
  }
};
