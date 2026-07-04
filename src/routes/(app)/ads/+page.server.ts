import type { PageServerLoad } from './$types';
import { error } from '@sveltejs/kit';
import { getCoreCtx } from '$server/auth/core-ctx';
import { isModuleEnabled } from '$server/services/modules.service';
import {
  adKpis,
  adSpendSeries,
  campaignBreakdown,
  postPerformance,
  listConnections,
  type DateRange,
} from '$server/services/meta/meta-insights.service';

/** Default last 30 days; either bound overridable via ?from=&to= (YYYY-MM-DD). */
function parseRange(url: URL): DateRange {
  const now = new Date();
  const defaultTo = now.toISOString().slice(0, 10);
  const from30 = new Date(now);
  from30.setDate(from30.getDate() - 30);
  const defaultFrom = from30.toISOString().slice(0, 10);
  return { from: url.searchParams.get('from') || defaultFrom, to: url.searchParams.get('to') || defaultTo };
}

export const load: PageServerLoad = async ({ locals, url, depends }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401, 'Authentication required');
  if (!(await isModuleEnabled(ctx, 'ads'))) throw error(404, 'Ads module disabled');
  depends('ads:data');

  const range = parseRange(url);
  const connections = await listConnections(ctx);
  const hasConnection = connections.some((c) => c.status !== 'revoked');

  if (!hasConnection) {
    return { range, hasConnection, kpis: null, series: [], campaigns: [], posts: [] };
  }

  const [kpis, series, campaigns, posts] = await Promise.all([
    adKpis(ctx, range),
    adSpendSeries(ctx, range),
    campaignBreakdown(ctx, range, 'campaign'),
    postPerformance(ctx, { limit: 5, orderBy: 'score' }),
  ]);

  return { range, hasConnection, kpis, series, campaigns: campaigns.slice(0, 10), posts };
};
