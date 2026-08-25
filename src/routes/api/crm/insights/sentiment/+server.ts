import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { getCoreCtx } from '$server/auth/core-ctx';
import { scoreSentimentBatch } from '$server/services/crm-insights.service';
import { invalidateTags, tags } from '@minion-stack/cache';
import { refreshSentimentRollupRange } from '$server/services/crm-sentiment-rollup.service';

/** POST /api/crm/insights/sentiment → score one capped batch of unscored inbound messages. */
export const POST: RequestHandler = async ({ locals }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401, 'Authentication required');
  const result = await scoreSentimentBatch(ctx, { cap: 50 });
  if (result.scored > 0 && result.fromDay && result.toDay) {
    await refreshSentimentRollupRange(result.fromDay, result.toDay, ctx.tenantId);
    await invalidateTags([...tags.tenantDomain(ctx.tenantId, 'crm')]);
  }
  return json(result);
};
