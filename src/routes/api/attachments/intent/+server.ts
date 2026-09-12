import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { z } from 'zod';
import { getCoreCtx } from '$server/auth/core-ctx';
import { parseBody } from '$server/api/validate';
import { createUploadIntent } from '$server/services/attachments.service';
import { getAttachmentAccess } from '../_guard';
import { ATTACHMENT_OBJECT_TYPES } from '$server/db/pg-attachments-schema';
import { handleAttachmentError } from '../_errors';

const intentSchema = z.object({
  fileName: z.string().min(1).max(500),
  contentType: z.string().min(1).max(200),
  sizeBytes: z.number().int().positive(),
  category: z.literal('attachment').optional(),
  links: z
    .array(z.object({ objectType: z.enum(ATTACHMENT_OBJECT_TYPES), objectId: z.string().uuid() }))
    .max(50)
    .optional(),
});

/** POST /api/attachments/intent — reserve a `files` row + hand back a
 *  presigned PUT url for the browser-direct upload path (recon §4.3). */
export const POST: RequestHandler = async ({ locals, request }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);

  const body = await parseBody(request, intentSchema);
  const access = await getAttachmentAccess(locals, ctx, 'edit');
  try {
    const intent = await createUploadIntent(
      ctx,
      { ...body, uploadedBy: locals.user?.supabaseId },
      access,
    );
    return json(intent);
  } catch (e) {
    return handleAttachmentError(e);
  }
};
