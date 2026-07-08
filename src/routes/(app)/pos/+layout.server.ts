import { error } from '@sveltejs/kit';
import type { LayoutServerLoad } from './$types';
import { getCoreCtx } from '$server/auth/core-ctx';
import { isModuleEnabled } from '$server/services/modules.service';
import { getPosSettings, getOpenShift } from '$server/services/pos.service';
import { listUsers } from '$server/services/user.service';

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
  // ponytail: reuses listUsers() (already proven to typecheck against CoreCtx,
  // unlike getUser()'s legacy TenantContext param) rather than a single-row lookup.
  const openerName = openShift?.shift.openedBy
    ? ((await listUsers(ctx).catch(() => [])).find((u) => u.id === openShift.shift.openedBy)?.displayName ?? null)
    : null;

  return { stockEnabled, schedulingEnabled, posSettings, openShift, openerName };
};
