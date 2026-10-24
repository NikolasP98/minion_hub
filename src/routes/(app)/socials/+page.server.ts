import type { PageServerLoad } from './$types';
import { datasetCtx, isDenied } from '$server/auth/dataset-ctx';
import {
  extentToRange,
  socialDashboardContext,
  socialDashboardData,
  type DataExtent,
  type DateRange,
} from '$server/services/meta/meta-insights.service';
import { ServerTiming } from '$lib/server/server-timing';
import { getFinSettings } from '$server/services/finance.service';
import { dateKeyAddDays, instantDateKey } from '$lib/time/zoned';
import { DEFAULT_SCHEDULING_TIME_ZONE } from '$lib/components/scheduling/calendar-window';

/** Default last 30 days ending today — UNLESS the org's newest ad data is
 *  already older than 30 days, in which case default to the full history
 *  (same "don't look empty on refresh" logic as /socials/campaigns) so a fresh
 *  org (no data) still gets the familiar last-30d window. Either bound
 *  overridable via ?from=&to= (YYYY-MM-DD). */
function resolveRange(url: URL, extent: DataExtent, now: Date, timeZone: string): DateRange {
  const hasExplicitRange = url.searchParams.has('from') || url.searchParams.has('to');
  const to = instantDateKey(now, timeZone);
  const from = dateKeyAddDays(to, -30) ?? to;
  const last30 = { from, to };
  const newestIsStale = extent.maxDate != null && extent.maxDate < from;
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
  const ctx = await datasetCtx(locals, 'ads');
  if (isDenied(ctx)) return { ads: ctx }; // rendered by DataSource (spec 039)
  depends('ads:data');

  // Timezone is FINANCE data: own handle; denied => default tz (spec 039).
  const fin = await datasetCtx(locals, 'finance');
  const [context, settings] = await Promise.all([
    timing.measure('social_context', () => socialDashboardContext(ctx)),
    isDenied(fin)
      ? Promise.resolve({ timezone: DEFAULT_SCHEDULING_TIME_ZONE })
      : getFinSettings(fin),
  ]);
  const { hasConnection } = context;
  const extent: DataExtent = hasConnection ? context.extent : { minDate: null, maxDate: null };
  const range = resolveRange(url, extent, new Date(), settings.timezone);

  if (!hasConnection) {
    setHeaders({ 'Server-Timing': timing.headerValue() });
    return {
      ads: {
        range,
        timeZone: settings.timezone,
        hasConnection,
        extent,
        kpis: null,
        series: [],
        campaigns: [],
        posts: [],
      },
    };
  }

  const dashboard = await timing.measure('social_data', () => socialDashboardData(ctx, range));
  setHeaders({ 'Server-Timing': timing.headerValue() });

  return {
    ads: { range, timeZone: settings.timezone, hasConnection, extent, ...dashboard },
  };
};
