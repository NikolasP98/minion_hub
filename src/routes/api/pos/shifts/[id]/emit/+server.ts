import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { getCoreCtx } from '$server/auth/core-ctx';
import { isModuleEnabled } from '$server/services/modules.service';
import { requireOrgCapability } from '$server/services/rbac.service';
import { emitShiftTickets } from '$server/services/pos.service';
import { handlePosError } from '../../../_errors';

/** POST /api/pos/shifts/:id/emit — "Reintentar" on /pos/history: emit the
 *  shift's live tickets SUNAT has not accepted yet (absent or `error` rows
 *  only, I5). `pos:manage`, the shift-level capability. */
export const POST: RequestHandler = async ({ locals, params }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  if (!(await isModuleEnabled(ctx, 'pos'))) throw error(404);
  await requireOrgCapability(locals, 'pos', 'manage');
  try {
    return json({ ok: true, ...(await emitShiftTickets(ctx, params.id!)) });
  } catch (e) {
    return handlePosError(e);
  }
};
