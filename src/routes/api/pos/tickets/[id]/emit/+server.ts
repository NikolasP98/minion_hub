import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { getCoreCtx } from '$server/auth/core-ctx';
import { isModuleEnabled } from '$server/services/modules.service';
import { requireOrgCapability } from '$server/services/rbac.service';
import { emitTicketNow } from '$server/services/pos.service';
import { handlePosError } from '../../../_errors';

/** POST /api/pos/tickets/:id/emit — "Emitir ahora": hand ONE live ticket to
 *  SUNAT before its shift closes (spec 2026-10-15 T2). `pos:edit`, like the
 *  other till writes; refusals are 409 `{error, code}`. */
export const POST: RequestHandler = async ({ locals, params }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  if (!(await isModuleEnabled(ctx, 'pos'))) throw error(404);
  await requireOrgCapability(locals, 'pos', 'edit');
  try {
    const emissions = await emitTicketNow(ctx, params.id!);
    return json({ ok: true, emissions });
  } catch (e) {
    return handlePosError(e);
  }
};
