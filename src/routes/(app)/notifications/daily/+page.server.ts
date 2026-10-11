import type { PageServerLoad } from './$types';
import { requireAuth } from '$server/auth/authorize';
import { requireCoreCtx } from '$server/auth/core-ctx';
import { requireOrgCapability, shouldMaskSensitive } from '$server/services/rbac.service';
import { getDailyFeedView } from '$server/services/inbox/daily-feed.service';

/** The always-available daily feed — the knock's href lands here. It aggregates
 *  appointments, register state and sales, so the reader needs the same view
 *  capabilities the POS calendar and till require, and money is masked for a
 *  role without finance visibility (security review 2026-10-10). */
export const load: PageServerLoad = async ({ locals, url }) => {
  requireAuth(locals);
  await requireOrgCapability(locals, 'scheduling', 'view');
  await requireOrgCapability(locals, 'pos', 'view');
  const ctx = await requireCoreCtx(locals);
  const view = await getDailyFeedView(ctx, url.searchParams.get('date') ?? undefined);
  const maskMoney = await shouldMaskSensitive(locals, 'finance');
  return {
    // Field-level RBAC: ship no amount at all when masked, the page shows the count only.
    view: maskMoney ? { ...view, yesterdaySales: { ...view.yesterdaySales, total: '' } } : view,
    maskMoney,
  };
};
