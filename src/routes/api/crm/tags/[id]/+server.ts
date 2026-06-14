import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { getCoreCtx } from '$server/auth/core-ctx';
import { deleteTag } from '$server/services/crm-contacts.service';

/** DELETE /api/crm/tags/[id] — remove a tag definition (cascades applications). */
export const DELETE: RequestHandler = async ({ locals, params }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  await deleteTag(ctx, params.id!);
  return json({ ok: true });
};
