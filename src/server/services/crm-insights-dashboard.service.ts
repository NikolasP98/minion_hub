import { cached, keys, tags } from '@minion-stack/cache';
import type { CoreCtx } from '$server/auth/core-ctx';
import { currentSentiment, type SentimentGranularity } from './crm-insights.service';
import { wordFrequencyRollup } from './crm-word-frequency-rollup.service';
import { sentimentByDayRollup } from './crm-sentiment-rollup.service';
import { getWinAnalysis, winIndexStatus } from './crm-similarity.service';
import { conversationThemes, pendingAnalysisCount } from './crm-conversation-analysis.service';

export type CrmInsightsRange = '30d' | '90d' | '365d' | 'all';

export interface CrmInsightsDashboardOptions {
  range: CrmInsightsRange;
  sentimentGranularity: SentimentGranularity;
  fromIso: string;
  toIso: string;
}

/**
 * One stable, stale-while-revalidate snapshot for the whole Insights page.
 * The old page keyed its expensive word-frequency cache with Date.now-derived
 * ISO bounds, so every navigation generated a unique key and re-ran the 6–11s
 * ts_stat scan. Range + granularity are the user-visible semantics and remain
 * stable for the TTL; the first caller's exact rolling bounds become the
 * snapshot boundary until the background refresh replaces it.
 */
export function crmInsightsDashboard(ctx: CoreCtx, opts: CrmInsightsDashboardOptions) {
  return cached(
    keys.hub('crm-insights-dashboard', {
      t: ctx.tenantId,
      d: { range: opts.range, sentimentGranularity: opts.sentimentGranularity },
    }),
    {
      ttl: '5m',
      swr: '30m',
      tags: [...tags.tenantDomain(ctx.tenantId, 'crm')],
    },
    async () => {
      const [words, sentiment, current, winIndex, winAnalysis, themes, pendingAnalysis] =
        await Promise.all([
          wordFrequencyRollup(ctx, { fromIso: opts.fromIso, toIso: opts.toIso, limit: 60 }),
          sentimentByDayRollup(ctx, { granularity: opts.sentimentGranularity }),
          currentSentiment(ctx),
          winIndexStatus(ctx),
          getWinAnalysis(ctx),
          conversationThemes(ctx, { since: opts.range === 'all' ? undefined : opts.fromIso }),
          pendingAnalysisCount(ctx),
        ]);
      return { words, sentiment, current, winIndex, winAnalysis, themes, pendingAnalysis };
    },
  );
}
