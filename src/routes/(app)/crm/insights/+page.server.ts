import type { PageServerLoad } from './$types';
import { error } from '@sveltejs/kit';
import { getCoreCtx } from '$server/auth/core-ctx';
import { wordFrequency, sentimentByMonth, currentSentiment } from '$server/services/crm-insights.service';

const DAY_MS = 24 * 60 * 60 * 1000;
const RANGE_DAYS: Record<string, number> = { '30d': 30, '90d': 90, '365d': 365 };

export const load: PageServerLoad = async ({ locals, url }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401, 'Authentication required');

  const range = url.searchParams.get('range') ?? '90d';
  const now = Date.now();
  const days = RANGE_DAYS[range];
  const fromIso = (range === 'all' || !days ? new Date(0) : new Date(now - days * DAY_MS)).toISOString();
  const toIso = new Date(now).toISOString();

  const [words, sentiment, current] = await Promise.all([
    wordFrequency(ctx, { fromIso, toIso, limit: 60 }),
    sentimentByMonth(ctx),
    currentSentiment(ctx),
  ]);

  return { words, sentiment, current, range: RANGE_DAYS[range] ? range : 'all' };
};
