import type { PageServerLoad } from './$types';
import { error } from '@sveltejs/kit';
import { datasetCtx, isDenied } from '$server/auth/dataset-ctx';
import { uuidParamOr404 } from '$server/utils/uuid-param';
import {
  adDataExtent,
  extentToRange,
  getCampaignDetail,
  type DataExtent,
  type DateRange,
} from '$server/services/meta/meta-insights.service';
import { listCampaignLeads } from '$server/services/meta/attribution.service';

export const load: PageServerLoad = async ({ locals, params, url, depends }) => {
  uuidParamOr404(params.campaignId);
  const ctx = await datasetCtx(locals, 'ads');
  if (isDenied(ctx)) return { ads: ctx }; // rendered by DataSource (spec 039)
  depends('ads:data');

  // Same range semantics as the campaigns list page: explicit ?from=&to= wins,
  // otherwise default to the org's full ad-data history.
  const extent: DataExtent = await adDataExtent(ctx);
  const hasExplicitRange = url.searchParams.has('from') || url.searchParams.has('to');
  const defaultRange = extentToRange(extent);
  const range: DateRange = hasExplicitRange
    ? {
        from: url.searchParams.get('from') || defaultRange.from,
        to: url.searchParams.get('to') || defaultRange.to,
      }
    : defaultRange;

  const campaign = await getCampaignDetail(ctx, params.campaignId, range);
  if (!campaign) throw error(404, 'Campaign not found');

  // CRM leads attributed to this campaign's ads (webhook referral + icebreaker
  // heuristic) — all-time, not range-scoped: a lead acquired by the ad stays a
  // lead of the campaign regardless of the metrics window above.
  // Leads are CRM contacts: own handle; denied => none (spec 039).
  const crm = await datasetCtx(locals, 'crm');
  const leads = isDenied(crm) ? [] : await listCampaignLeads(crm, params.campaignId);

  return { ads: { campaign, leads, range, currency: extent.currency } };
};
