import { cached, keys, tags } from '@minion-stack/cache';
import type { CoreCtx } from '$server/auth/core-ctx';
import { scopeData } from './base';
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
  /** Record-level (if-owner) scope — see the gating note below. */
  ownerId?: string;
}

/**
 * One stable, stale-while-revalidate snapshot for the whole Insights page.
 * The old page keyed its expensive word-frequency cache with Date.now-derived
 * ISO bounds, so every navigation generated a unique key and re-ran the 6–11s
 * ts_stat scan. Range + granularity are the user-visible semantics and remain
 * stable for the TTL; the first caller's exact rolling bounds become the
 * snapshot boundary until the background refresh replaces it.
 *
 * `ownerId` scopes `themes`/`pendingAnalysis` for real (both join through
 * `crm_conversation_analysis`/`crm_conversation_index`'s own `contact_id`).
 * `words`/`sentiment`/`current`/`winIndex`/`winAnalysis` are precomputed
 * ORG-WIDE rollups (`crm_word_frequency_daily`, `crm_sentiment_chat_daily`,
 * `crm_win_embeddings`, and the single-row win-analysis settings blob) with no
 * owner dimension baked into the rollup itself — scoping them needs a rollup
 * redesign (an owner_id column threaded through each refresh pipeline), out
 * of this slice. An owner-scoped caller gets each field's own no-data/disabled
 * shape instead, computed (and cached, under the ownerId-keyed cache entry
 * below) BEFORE the org-wide query ever runs — never org-wide data trimmed
 * after the fact.
 * TODO(handoff): scope word-frequency/sentiment/win-index rollups by owner
 * (needs an owner_id dimension on crm_word_frequency_daily,
 * crm_sentiment_chat_daily, crm_win_embeddings + a per-owner win analysis).
 */
export function crmInsightsDashboard(ctx: CoreCtx, opts: CrmInsightsDashboardOptions) {
  const { ownerId } = opts;
  return cached(
    keys.hub('crm-insights-dashboard', {
      t: ctx.tenantId,
      d: scopeData({ range: opts.range, sentimentGranularity: opts.sentimentGranularity, ownerId }),
    }),
    {
      ttl: '5m',
      swr: '30m',
      tags: [...tags.tenantDomain(ctx.tenantId, 'crm')],
    },
    async () => {
      const [words, sentiment, current, winIndex, winAnalysis, themes, pendingAnalysis] =
        await Promise.all([
          ownerId
            ? Promise.resolve([])
            : wordFrequencyRollup(ctx, { fromIso: opts.fromIso, toIso: opts.toIso, limit: 60 }),
          ownerId
            ? Promise.resolve([])
            : sentimentByDayRollup(ctx, { granularity: opts.sentimentGranularity }),
          ownerId ? Promise.resolve(null) : currentSentiment(ctx),
          ownerId ? Promise.resolve({ count: 0, builtAt: null, thin: false }) : winIndexStatus(ctx),
          ownerId ? Promise.resolve(null) : getWinAnalysis(ctx),
          conversationThemes(ctx, {
            since: opts.range === 'all' ? undefined : opts.fromIso,
            ownerId,
          }),
          pendingAnalysisCount(ctx, ownerId),
        ]);
      return { words, sentiment, current, winIndex, winAnalysis, themes, pendingAnalysis };
    },
  );
}
