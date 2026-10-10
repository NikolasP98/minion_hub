import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { getCoreCtx } from '$server/auth/core-ctx';
import { isModuleEnabled } from '$server/services/modules.service';
import { getOpenShift, listShiftPayments } from '$server/services/pos.service';

/**
 * GET /api/pos/shifts/current — `{shift, summary}` or `{shift: null}`.
 *
 * `?payments=1` adds `payments`: every non-void payment of the open shift, for
 * the shift banner's per-method income menu. Opt-in because the close-shift
 * modal reads this same endpoint and only needs the sums.
 */
export const GET: RequestHandler = async ({ locals, url }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  if (!(await isModuleEnabled(ctx, 'pos'))) throw error(404);
  const open = await getOpenShift(ctx);
  if (!open) return json({ shift: null });
  if (url.searchParams.get('payments') !== '1') return json(open);
  return json({ ...open, payments: await listShiftPayments(ctx, open.shift.id) });
};
