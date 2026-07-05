import type { PageServerLoad } from './$types';
import { error } from '@sveltejs/kit';
import { getCoreCtx } from '$server/auth/core-ctx';
import { isModuleEnabled } from '$server/services/modules.service';
import {
  adDataExtent,
  adKpis,
  adSpendSeries,
  campaignBreakdown,
  extentToRange,
  postPerformance,
  listConnections,
  type DataExtent,
  type DateRange,
} from '$server/services/meta/meta-insights.service';

const THIRTY_DAYS_MS = 30 * 86_400_000;

/** Default last 30 days ending today — UNLESS the org's newest ad data is
 *  already older than 30 days, in which case default to the full history
 *  (same "don't look empty on refresh" logic as /ads/campaigns) so a fresh
 *  org (no data) still gets the familiar last-30d window. Either bound
 *  overridable via ?from=&to= (YYYY-MM-DD). */
function resolveRange(url: URL, extent: DataExtent): DateRange {
  const hasExplicitRange = url.searchParams.has('from') || url.searchParams.has('to');
  const now = new Date();
  const last30 = extentToRange({ minDate: null, maxDate: null }, now);
  const newestIsStale = extent.maxDate != null && now.getTime() - new Date(`${extent.maxDate}T00:00:00Z`).getTime() > THIRTY_DAYS_MS;
  const defaultRange = newestIsStale ? extentToRange(extent, now) : last30;
  return hasExplicitRange
    ? { from: url.searchParams.get('from') || defaultRange.from, to: url.searchParams.get('to') || defaultRange.to }
    : defaultRange;
}

export const load: PageServerLoad = async ({ locals, url, depends }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401, 'Authentication required');
  if (!(await isModuleEnabled(ctx, 'ads'))) throw error(404, 'Ads module disabled');
  depends('ads:data');

  const connections = await listConnections(ctx);
  const hasConnection = connections.some((c) => c.status !== 'revoked');
  const extent: DataExtent = hasConnection ? await adDataExtent(ctx) : { minDate: null, maxDate: null };
  const range = resolveRange(url, extent);

  if (!hasConnection) {
    return { range, hasConnection, extent, kpis: null, series: [], campaigns: [], posts: [] };
  }

  const [kpis, series, campaigns, posts] = await Promise.all([
    adKpis(ctx, range),
    adSpendSeries(ctx, range),
    campaignBreakdown(ctx, range, 'campaign'),
    postPerformance(ctx, { limit: 5, orderBy: 'score' }),
  ]);

  return { range, hasConnection, extent, kpis, series, campaigns: campaigns.slice(0, 10), posts };
};
