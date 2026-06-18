import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { getCoreCtx } from '$server/auth/core-ctx';
import { buildWinIndex, winIndexStatus } from '$server/services/crm-similarity.service';

/** POST /api/crm/insights/win-index → (re)build the winning-conversation index. */
export const POST: RequestHandler = async ({ locals }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401, 'Authentication required');
  await buildWinIndex(ctx);
  return json(await winIndexStatus(ctx));
};
