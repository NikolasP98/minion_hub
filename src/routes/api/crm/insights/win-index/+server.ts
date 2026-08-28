import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { getCoreCtx } from '$server/auth/core-ctx';
import { buildWinIndex, winIndexStatus } from '$server/services/crm-similarity.service';
import { invalidateTags, tags } from '@minion-stack/cache';

/** POST /api/crm/insights/win-index → (re)build the winning-conversation index. */
export const POST: RequestHandler = async ({ locals }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401, 'Authentication required');
  await buildWinIndex(ctx);
  await invalidateTags([...tags.tenantDomain(ctx.tenantId, 'crm')]);
  return json(await winIndexStatus(ctx));
};
