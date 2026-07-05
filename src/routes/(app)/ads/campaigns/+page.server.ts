import type { PageServerLoad } from './$types';
import { error } from '@sveltejs/kit';
import { getCoreCtx } from '$server/auth/core-ctx';
import { isModuleEnabled } from '$server/services/modules.service';
import {
  adDataExtent,
  campaignBreakdown,
  extentToRange,
  listConnections,
  type CampaignLevel,
  type DataExtent,
  type DateRange,
} from '$server/services/meta/meta-insights.service';

function parseLevel(url: URL): CampaignLevel {
  const v = url.searchParams.get('level');
  return v === 'campaign' || v === 'adset' || v === 'ad' ? v : 'ad';
}

export const load: PageServerLoad = async ({ locals, url, depends }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401, 'Authentication required');
  if (!(await isModuleEnabled(ctx, 'ads'))) throw error(404, 'Ads module disabled');
  depends('ads:data');

  const level = parseLevel(url);
  const connections = await listConnections(ctx);
  const hasConnection = connections.some((c) => c.status !== 'revoked');

  const extent: DataExtent = hasConnection ? await adDataExtent(ctx) : { minDate: null, maxDate: null };
  // No ?from=&to= at all → default to the org's FULL ad-data history, not a
  // hardcoded last-30d window, so a plain refresh/share never looks "empty"
  // just because spend happened outside the last 30 days.
  const hasExplicitRange = url.searchParams.has('from') || url.searchParams.has('to');
  const defaultRange = extentToRange(extent);
  const range: DateRange = hasExplicitRange
    ? { from: url.searchParams.get('from') || defaultRange.from, to: url.searchParams.get('to') || defaultRange.to }
    : defaultRange;

  const rows = hasConnection ? await campaignBreakdown(ctx, range, level) : [];
  return { range, level, hasConnection, rows, extent };
};
