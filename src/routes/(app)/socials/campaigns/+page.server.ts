import type { PageServerLoad } from './$types';
import { error } from '@sveltejs/kit';
import { getCoreCtx } from '$server/auth/core-ctx';
import { isModuleEnabled } from '$server/services/modules.service';
import {
  adDataExtent,
  campaignBreakdown,
  extentToRange,
  listConnections,
  type DataExtent,
  type DateRange,
} from '$server/services/meta/meta-insights.service';

export const load: PageServerLoad = async ({ locals, url, depends }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401, 'Authentication required');
  if (!(await isModuleEnabled(ctx, 'ads'))) throw error(404, 'Ads module disabled');
  depends('ads:data');

  const connections = await listConnections(ctx);
  const hasConnection = connections.some((c) => c.status !== 'revoked');

  const extent: DataExtent = hasConnection ? await adDataExtent(ctx) : { minDate: null, maxDate: null };
  // No ?from=&to= at all → default to the org's FULL ad-data history.
  const hasExplicitRange = url.searchParams.has('from') || url.searchParams.has('to');
  const defaultRange = extentToRange(extent);
  const range: DateRange = hasExplicitRange
    ? { from: url.searchParams.get('from') || defaultRange.from, to: url.searchParams.get('to') || defaultRange.to }
    : defaultRange;

  // Fetch all three levels so the table can expand campaign → ad set → ad in one
  // hierarchy with API-accurate metrics at every level (reach isn't additive, so
  // we can't derive parents by summing children — each level comes from Postgres).
  const [campaigns, adsets, ads] = hasConnection
    ? await Promise.all([
        campaignBreakdown(ctx, range, 'campaign'),
        campaignBreakdown(ctx, range, 'adset'),
        campaignBreakdown(ctx, range, 'ad'),
      ])
    : [[], [], []];

  return { range, hasConnection, campaigns, adsets, ads, extent };
};
