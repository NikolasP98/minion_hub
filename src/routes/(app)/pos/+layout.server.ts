import { error } from '@sveltejs/kit';
import type { LayoutServerLoad } from './$types';
import { getCoreCtx } from '$server/auth/core-ctx';
import { isModuleEnabled } from '$server/services/modules.service';
import { getPosSettings, getOpenShift } from '$server/services/pos.service';
import { getUser } from '$server/services/user.service';
import type { TenantContext } from '$server/services/base';

/** Gate the whole /pos subtree on the per-org module toggle; feed shift + settings state to PosNav/ShiftBanner. */
export const load: LayoutServerLoad = async ({ locals, depends }) => {
  depends('pos:shift');

  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401, 'Authentication required');
  if (!(await isModuleEnabled(ctx, 'pos'))) throw error(404, 'POS module disabled');

  const [stockEnabled, schedulingEnabled, posSettings, openShift] = await Promise.all([
    isModuleEnabled(ctx, 'stock'),
    isModuleEnabled(ctx, 'scheduling'),
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
