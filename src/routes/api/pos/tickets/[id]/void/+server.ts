import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { getCoreCtx } from '$server/auth/core-ctx';
import { isModuleEnabled } from '$server/services/modules.service';
import { requireOrgCapability } from '$server/services/rbac.service';
import { voidTicket } from '$server/services/pos.service';
import { handlePosError } from '../../../_errors';

/** POST /api/pos/tickets/:id/void */
export const POST: RequestHandler = async ({ locals, params }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  if (!(await isModuleEnabled(ctx, 'pos'))) throw error(404);
  await requireOrgCapability(locals, 'pos', 'manage');
  const actor = { id: ctx.profileId ?? null, name: locals.user?.displayName ?? locals.user?.email ?? null };
  try {
    const ticket = await voidTicket(ctx, params.id!, actor);
    return json({ ok: true, ticket });
  } catch (e) {
    handlePosError(e);
  }
};
