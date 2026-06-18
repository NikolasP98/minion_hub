import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { getCoreCtx } from '$server/auth/core-ctx';
import { scoreSentimentBatch } from '$server/services/crm-insights.service';

/** POST /api/crm/insights/sentiment → score one capped batch of unscored inbound messages. */
export const POST: RequestHandler = async ({ locals }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401, 'Authentication required');
  const result = await scoreSentimentBatch(ctx, { cap: 50 });
  return json(result);
};
