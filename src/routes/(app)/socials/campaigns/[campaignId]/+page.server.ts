import type { PageServerLoad } from './$types';
import { error } from '@sveltejs/kit';
import { getCoreCtx } from '$server/auth/core-ctx';
import { isModuleEnabled } from '$server/services/modules.service';
import { uuidParamOr404 } from '$server/utils/uuid-param';
import {
  adDataExtent,
  extentToRange,
  getCampaignDetail,
  type DataExtent,
  type DateRange,
} from '$server/services/meta/meta-insights.service';

export const load: PageServerLoad = async ({ locals, params, url, depends }) => {
  uuidParamOr404(params.campaignId);
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401, 'Authentication required');
  if (!(await isModuleEnabled(ctx, 'ads'))) throw error(404, 'Ads module disabled');
  depends('ads:data');

  // Same range semantics as the campaigns list page: explicit ?from=&to= wins,
  // otherwise default to the org's full ad-data history.
  const extent: DataExtent = await adDataExtent(ctx);
  const hasExplicitRange = url.searchParams.has('from') || url.searchParams.has('to');
  const defaultRange = extentToRange(extent);
  const range: DateRange = hasExplicitRange
    ? { from: url.searchParams.get('from') || defaultRange.from, to: url.searchParams.get('to') || defaultRange.to }
    : defaultRange;

  const campaign = await getCampaignDetail(ctx, params.campaignId, range);
  if (!campaign) throw error(404, 'Campaign not found');

  return { campaign, range, currency: extent.currency };
};
