import type { PageServerLoad } from './$types';
import { error } from '@sveltejs/kit';
import { getCoreCtx } from '$server/auth/core-ctx';
import {
  adKpis,
  adSpendSeries,
  extentToRange,
  postPerformance,
  socialDashboardContext,
  syncJobHistory,
  type DataExtent,
  type DateRange,
} from '$server/services/meta/meta-insights.service';
import { adPerformanceByCampaign } from '$server/services/meta/ad-performance.service';
import { ALL_PERIODS, type Period } from '$lib/components/dashboard/date-range';
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

/** Chart granularity. Bucketing itself happens client-side over the daily
 *  series (already loaded) — the server only echoes a validated selection so
 *  the choice survives a reload / shared link. */
function resolvePeriod(url: URL): Period {
  const p = url.searchParams.get('period');
  return (ALL_PERIODS as string[]).includes(p ?? '') ? (p as Period) : 'day';
}

export const load: PageServerLoad = async ({ locals, url, depends, setHeaders }) => {
  const timing = new ServerTiming();
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401, 'Authentication required');
  depends('ads:data');

  // Connection state + ad-data extent in one cached RLS transaction — serializing
  // them costs a full round-trip each against a remote pooler.
  const context = await timing.measure('social_context', () => socialDashboardContext(ctx));
  const { hasConnection } = context;
  const extent: DataExtent = hasConnection ? context.extent : { minDate: null, maxDate: null };
  const range = resolveRange(url, extent);
  const period = resolvePeriod(url);

  if (!hasConnection) {
    setHeaders({ 'Server-Timing': timing.headerValue() });
    return {
      range,
      period,
      hasConnection,
      extent,
      kpis: null,
      series: [],
      campaigns: [],
      conversations: 0,
      posts: [],
      lastSync: null,
    };
  }

  // `performance` (campaign rollup + conversations) carries the spend the
  // by-campaign chart needs, so there's no separate campaignBreakdown query.
  // NOTE: not `socialDashboardData()` — that helper slices campaigns to the top
  // 10 and drops the sync history, so the org-wide `conversations` total and the
  // freshness strip below could not be derived from it.
  const [kpis, series, performance, posts, syncJobs] = await timing.measure('social_data', () =>
    Promise.all([
      adKpis(ctx, range),
      adSpendSeries(ctx, range),
      adPerformanceByCampaign(ctx, range),
      postPerformance(ctx, { limit: 5, orderBy: 'score' }),
      syncJobHistory(ctx, { limit: 50 }),
    ]),
  );
  setHeaders({ 'Server-Timing': timing.headerValue() });

  // Freshness strip: the newest ads sync that actually finished.
  const lastSync = syncJobs.find((j) => j.kind === 'ads' && j.finishedAt != null) ?? null;
  // Conversations total covers EVERY campaign; only the top spenders are shipped
  // for the chart/table.
  const conversations = performance.reduce((n, r) => n + r.conversationsStarted, 0);

  return {
    range,
    period,
    hasConnection,
    extent,
    kpis,
    series,
    campaigns: [...performance].sort((a, b) => b.spend - a.spend).slice(0, 10),
    conversations,
    posts,
    lastSync: lastSync && { finishedAt: lastSync.finishedAt, status: lastSync.status },
  };
};
