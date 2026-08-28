import type { PageServerLoad } from './$types';
import { error } from '@sveltejs/kit';
import { getCoreCtx } from '$server/auth/core-ctx';
import {
  extentToRange,
  socialDashboardContext,
  socialDashboardData,
  type DataExtent,
  type DateRange,
} from '$server/services/meta/meta-insights.service';
import { ServerTiming } from '$lib/server/server-timing';

const THIRTY_DAYS_MS = 30 * 86_400_000;

/** Default last 30 days ending today — UNLESS the org's newest ad data is
 *  already older than 30 days, in which case default to the full history
 *  (same "don't look empty on refresh" logic as /socials/campaigns) so a fresh
 *  org (no data) still gets the familiar last-30d window. Either bound
 *  overridable via ?from=&to= (YYYY-MM-DD). */
function resolveRange(url: URL, extent: DataExtent): DateRange {
  const hasExplicitRange = url.searchParams.has('from') || url.searchParams.has('to');
  const now = new Date();
  const last30 = extentToRange({ minDate: null, maxDate: null }, now);
  const newestIsStale =
    extent.maxDate != null &&
    now.getTime() - new Date(`${extent.maxDate}T00:00:00Z`).getTime() > THIRTY_DAYS_MS;
  const defaultRange = newestIsStale ? extentToRange(extent, now) : last30;
  return hasExplicitRange
    ? {
        from: url.searchParams.get('from') || defaultRange.from,
        to: url.searchParams.get('to') || defaultRange.to,
      }
    : defaultRange;
}

export const load: PageServerLoad = async ({ locals, url, depends, setHeaders }) => {
  const timing = new ServerTiming();
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401, 'Authentication required');
  depends('ads:data');

  const context = await timing.measure('social_context', () => socialDashboardContext(ctx));
  const { hasConnection } = context;
  const extent: DataExtent = hasConnection ? context.extent : { minDate: null, maxDate: null };
  const range = resolveRange(url, extent);

  if (!hasConnection) {
    setHeaders({ 'Server-Timing': timing.headerValue() });
    return { range, hasConnection, extent, kpis: null, series: [], campaigns: [], posts: [] };
  }

  const dashboard = await timing.measure('social_data', () => socialDashboardData(ctx, range));
  setHeaders({ 'Server-Timing': timing.headerValue() });

  return { range, hasConnection, extent, ...dashboard };
};
