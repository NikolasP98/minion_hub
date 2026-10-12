import { error } from '@sveltejs/kit';
import type { LayoutServerLoad } from './$types';
import { getCoreCtx } from '$server/auth/core-ctx';
import { getPosSettings, getOpenShift, listOpenShifts } from '$server/services/pos.service';
import { getUserNames } from '$server/services/user.service';
import { countPosPendingWork } from '$server/services/pos-accounts.service';

/** Auth guard for the whole /pos subtree; feed shift + settings state to
 *  PosNav/ShiftBanner. The module-toggle/kind 404 is enforced centrally by
 *  the (app) route hook guard now (routing-simplification spec S2); the
 *  stock/scheduling flags below are data-bearing (shape the returned UI
 *  state, not a gate) so they stay here, reading the hook's per-request
 *  module-state snapshot instead of re-querying (R5). */
export const load: LayoutServerLoad = async ({ locals, depends }) => {
  depends('pos:shift');
  // Side-menu Accounts badge (posPendingWork below) — its OWN key.
  // Root cause of the badge going stale after scheduling a pending line:
  // this load previously had no dependency of its own, so `invalidate(...)`
  // anywhere in the app could never make it rerun (only `pos:shift` could,
  // and nothing schedule-related touches that).
  depends('pos:pending');

  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401, 'Authentication required');

  const stockEnabled = locals.moduleStates?.stock ?? true;
  const schedulingEnabled = locals.moduleStates?.scheduling ?? true;
  const profileId = ctx.profileId ?? null;
  const [posSettings, openShift, allOpenShifts, posPendingWork] = await Promise.all([
    getPosSettings(ctx),
    // Shifts are per user: the banner shows the CALLER's own register.
    getOpenShift(ctx, profileId).catch(() => null),
    listOpenShifts(ctx).catch(() => []),
    // Side-menu counter (Accounts badge): paid-not-scheduled PLUS
    // scheduled-not-charged. Fail-soft: 0 when POS tables are off.
    countPosPendingWork(ctx).catch(() => 0),
  ]);

  // Best-effort display names — shift rows only store the profile uuid
  // (`openedBy`); resolve own + colleagues in ONE query so the banner never
  // has to.
  const others = allOpenShifts.filter((s) => s.openedBy !== profileId);
  const names = await getUserNames([
    openShift?.shift.openedBy ?? null,
    ...others.map((s) => s.openedBy),
  ]).catch(() => new Map<string, string>());
  const openerName = openShift?.shift.openedBy
    ? (names.get(openShift.shift.openedBy) ?? null)
    : null;

  return {
    stockEnabled,
    schedulingEnabled,
    posSettings,
    openShift,
    openerName,
    /** OTHER members' open registers, for the banner's colleagues indicator. */
    openShifts: others.map((s) => ({
      id: s.id,
      openedAt: s.openedAt,
      openedByName: (s.openedBy && names.get(s.openedBy)) || null,
    })),
    posPendingWork,
  };
};
