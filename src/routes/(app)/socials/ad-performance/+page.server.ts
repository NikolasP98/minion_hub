import type { PageServerLoad } from './$types';
import { error } from '@sveltejs/kit';
import { getCoreCtx } from '$server/auth/core-ctx';
import { isModuleEnabled } from '$server/services/modules.service';
import {
  adDataExtent,
  extentToRange,
  listConnections,
  type DataExtent,
  type DateRange,
} from '$server/services/meta/meta-insights.service';
import { adPerformance } from '$server/services/meta/ad-performance.service';

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

  const { campaigns, ads } = hasConnection
    ? await adPerformance(ctx, range)
    : { campaigns: [], ads: [] };

  return { range, hasConnection, campaigns, ads, extent };
};
