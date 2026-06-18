import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getCoreCtx } from '$server/auth/core-ctx';
import { isModuleEnabled } from '$server/services/modules.service';
import { schedulingSummary, utilizationHeatmap, revenueByResource } from '$server/services/scheduling-analytics.service';

const DAY = 86_400_000;

export const load: PageServerLoad = async ({ locals, depends }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401, 'Authentication required');
  if (!(await isModuleEnabled(ctx, 'scheduling'))) throw error(404, 'Scheduling module disabled');
  depends('scheduling:data');

  // A 4-week window centred near "now": last 7 days + next 21 days.
  const now = new Date();
  const todayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const from = new Date(todayStart.getTime() - 7 * DAY);
  const to = new Date(todayStart.getTime() + 21 * DAY);

  // Each analytic degrades independently: a slow/failed optional panel (e.g. the
  // revenue overlay's cross-module join hitting a statement timeout) must never
  // 500 the whole dashboard — it just renders without that panel.
  const EMPTY_SUMMARY = {
    upcoming: 0,
    bookedThisRange: 0,
    cancelled: 0,
    noShow: 0,
    resourceCount: 0,
    eventTypeCount: 0,
  };
  const [summary, utilization, revenue] = await Promise.all([
    schedulingSummary(ctx, from, to).catch(() => EMPTY_SUMMARY),
    utilizationHeatmap(ctx, from, to).catch(() => []),
    revenueByResource(ctx, from, to).catch(() => []),
  ]);

  return {
    summary,
    utilization,
    revenue,
    from: from.toISOString(),
    to: to.toISOString(),
  };
};
