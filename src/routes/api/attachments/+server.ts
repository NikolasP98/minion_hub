import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { z } from 'zod';
import { getCoreCtx } from '$server/auth/core-ctx';
import {
  listAttachmentsFor,
  listTrashedAttachmentsFor,
} from '$server/services/attachments.service';
import { getAttachmentAccess } from './_guard';
import { handleAttachmentError } from './_errors';
import { ATTACHMENT_OBJECT_TYPES } from '$server/db/pg-attachments-schema';

const querySchema = z.object({
  objectType: z.enum(ATTACHMENT_OBJECT_TYPES),
  objectId: z.string().uuid(),
});

/** GET /api/attachments?objectType=&objectId= — files linked to one object,
 *  each with its full link set (so the UI can show "also linked to X").
 *  `&trashed=1` lists the object's hidden (restorable) links instead. */
export const GET: RequestHandler = async ({ locals, url }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);

  const parsed = querySchema.safeParse({
    objectType: url.searchParams.get('objectType'),
    objectId: url.searchParams.get('objectId'),
  });
  if (!parsed.success) throw error(400, 'objectType and objectId are required');

  const access = await getAttachmentAccess(locals, ctx);
  try {
    if (url.searchParams.get('trashed') === '1') {
      const attachments = await listTrashedAttachmentsFor(
        ctx,
        parsed.data.objectType,
        parsed.data.objectId,
        access,
      );
      return json({ attachments });
    }
    const attachments = await listAttachmentsFor(
      ctx,
      parsed.data.objectType,
      parsed.data.objectId,
      access,
    );
    return json({ attachments });
  } catch (e) {
    return handleAttachmentError(e);
  }
};
