import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { requireTenantCtx } from '$server/auth/authorize';
import { listMemories, memoryStats, searchMemories } from '$server/services/agent-memories.service';
import { embedText, embeddingsEnabled } from '$server/services/embeddings';

/**
 * GET /api/agent-memories?agentId=…&limit=…[&stats=1]
 *   → { memories: MemoryRow[], stats?: {category,count}[] }
 * Org-scoped via the authenticated tenant; agent-scoped via agentId.
 */
export const GET: RequestHandler = async ({ locals, url }) => {
  const ctx = requireTenantCtx(locals);
  const agentId = url.searchParams.get('agentId');
  if (!agentId) throw error(400, 'agentId is required');

  const num = (k: string) => (url.searchParams.get(k) ? Number(url.searchParams.get(k)) : undefined);
  const memories = await listMemories(ctx.tenantId, {
    agentId,
    limit: num('limit'),
    offset: num('offset'),
  });

  const stats = url.searchParams.get('stats') ? await memoryStats(ctx.tenantId, agentId) : undefined;
  return json({ memories, ...(stats ? { stats } : {}) });
};

/**
 * POST /api/agent-memories  { agentId, query, limit? }
 *   → { hits: MemorySearchHit[] }   semantic search (embeds the query server-side)
 */
export const POST: RequestHandler = async ({ locals, request }) => {
  const ctx = requireTenantCtx(locals);
  if (!embeddingsEnabled()) throw error(503, 'Embeddings unavailable (OPENAI_API_KEY unset)');

  const body = (await request.json()) as { agentId?: string; query?: string; limit?: number };
  if (!body.agentId || !body.query?.trim()) throw error(400, 'agentId and query are required');

  const queryEmbedding = await embedText(body.query.trim());
  const hits = await searchMemories(ctx.tenantId, {
    agentId: body.agentId,
    queryEmbedding,
    limit: body.limit,
  });
  return json({ hits });
};
