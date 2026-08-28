import type { PageServerLoad } from './$types';
import { error } from '@sveltejs/kit';
import { getCoreCtx } from '$server/auth/core-ctx';
import { toSentimentGranularity } from '$server/services/crm-insights.service';
import {
  crmInsightsDashboard,
  type CrmInsightsRange,
} from '$server/services/crm-insights-dashboard.service';

const DAY_MS = 24 * 60 * 60 * 1000;
const RANGE_DAYS: Record<string, number> = { '30d': 30, '90d': 90, '365d': 365 };

export const load: PageServerLoad = async ({ locals, url }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401, 'Authentication required');

  const requestedRange = url.searchParams.get('range') ?? '90d';
  const range: CrmInsightsRange =
    requestedRange === '30d' ||
    requestedRange === '90d' ||
    requestedRange === '365d' ||
    requestedRange === 'all'
      ? requestedRange
      : 'all';
  const sentGranularity = toSentimentGranularity(url.searchParams.get('sent'));
  const now = Date.now();
  const days = RANGE_DAYS[range];
  const fromIso = (
    range === 'all' || !days ? new Date(0) : new Date(now - days * DAY_MS)
  ).toISOString();
  const toIso = new Date(now).toISOString();

  const dashboard = await crmInsightsDashboard(ctx, {
    range,
    sentimentGranularity: sentGranularity,
    fromIso,
    toIso,
  });

  return {
    ...dashboard,
    range,
    sentGranularity,
  };
};
