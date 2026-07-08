import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { getCoreCtx } from '$server/auth/core-ctx';
import { isModuleEnabled } from '$server/services/modules.service';
import { postTicketStock } from '$server/services/pos.service';
import { handlePosError } from '../../../_errors';

/** POST /api/pos/tickets/:id/post-stock — idempotent retry of the post-commit stock write. */
export const POST: RequestHandler = async ({ locals, params }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  if (!(await isModuleEnabled(ctx, 'pos'))) throw error(404);
  const actor = { id: ctx.profileId ?? null, name: locals.user?.displayName ?? locals.user?.email ?? null };
  try {
    const { entryId, stockWarning } = await postTicketStock(ctx, params.id!, actor);
    return json({ ok: true, entryId, stockWarning });
  } catch (e) {
    handlePosError(e);
  }
};
