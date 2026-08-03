import { error } from '@sveltejs/kit';
import type { LayoutServerLoad } from './$types';
import { getCoreCtx } from '$server/auth/core-ctx';
import { getPosSettings, getOpenShift } from '$server/services/pos.service';
import { getUser } from '$server/services/user.service';
import type { TenantContext } from '$server/services/base';

/** Auth guard for the whole /pos subtree; feed shift + settings state to
 *  PosNav/ShiftBanner. The module-toggle/kind 404 is enforced centrally by
 *  the (app) route hook guard now (routing-simplification spec S2); the
 *  stock/scheduling flags below are data-bearing (shape the returned UI
 *  state, not a gate) so they stay here, reading the hook's per-request
 *  module-state snapshot instead of re-querying (R5). */
export const load: LayoutServerLoad = async ({ locals, depends }) => {
  depends('pos:shift');

  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401, 'Authentication required');

  const stockEnabled = locals.moduleStates?.stock ?? true;
  const schedulingEnabled = locals.moduleStates?.scheduling ?? true;
  const [posSettings, openShift] = await Promise.all([
    getPosSettings(ctx),
    getOpenShift(ctx).catch(() => null),
  ]);

  // Best-effort opener display name — the shift row only stores the profile
  // uuid (`openedBy`); resolve it once here so the banner never has to.
  // ponytail: getUser ignores its ctx param (supabaseAdmin inside); cast bridges the vestigial TenantContext signature
  const openerName = openShift?.shift.openedBy
    ? ((await getUser(ctx as unknown as TenantContext, openShift.shift.openedBy).catch(() => null))?.displayName ?? null)
    : null;

  return { stockEnabled, schedulingEnabled, posSettings, openShift, openerName };
};
