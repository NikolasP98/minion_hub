import type { PageServerLoad } from './$types';
import { error } from '@sveltejs/kit';
import { getCoreCtx } from '$server/auth/core-ctx';
import { isModuleEnabled } from '$server/services/modules.service';
import { campaignBreakdown, listConnections, type CampaignLevel, type DateRange } from '$server/services/meta/meta-insights.service';

function parseRange(url: URL): DateRange {
  const now = new Date();
  const defaultTo = now.toISOString().slice(0, 10);
  const from30 = new Date(now);
  from30.setDate(from30.getDate() - 30);
  const defaultFrom = from30.toISOString().slice(0, 10);
  return { from: url.searchParams.get('from') || defaultFrom, to: url.searchParams.get('to') || defaultTo };
}

function parseLevel(url: URL): CampaignLevel {
  const v = url.searchParams.get('level');
  return v === 'campaign' || v === 'adset' || v === 'ad' ? v : 'ad';
}

export const load: PageServerLoad = async ({ locals, url, depends }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401, 'Authentication required');
  if (!(await isModuleEnabled(ctx, 'ads'))) throw error(404, 'Ads module disabled');
  depends('ads:data');

  const range = parseRange(url);
  const level = parseLevel(url);
  const connections = await listConnections(ctx);
  const hasConnection = connections.some((c) => c.status !== 'revoked');

  const rows = hasConnection ? await campaignBreakdown(ctx, range, level) : [];
  return { range, level, hasConnection, rows };
};
