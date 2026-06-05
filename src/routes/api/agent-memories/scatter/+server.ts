import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { requireTenantCtx } from '$server/auth/authorize';
import { scatterMemories } from '$server/services/agent-memories.service';

/**
 * GET /api/agent-memories/scatter?agentId=…
 *   → { points: ScatterPoint[] }   2D PCA projection of the agent's embeddings.
 */
export const GET: RequestHandler = async ({ locals, url }) => {
  const ctx = requireTenantCtx(locals);
  const agentId = url.searchParams.get('agentId');
  if (!agentId) throw error(400, 'agentId is required');
  const points = await scatterMemories(ctx.tenantId, agentId);
  return json({ points });
};
