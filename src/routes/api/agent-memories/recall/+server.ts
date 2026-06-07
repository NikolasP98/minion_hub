import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { searchMemories } from '$server/services/agent-memories.service';
import { embedText, embeddingsEnabled } from '$server/services/embeddings';

/**
 * POST /api/agent-memories/recall  { agentId, query, limit? }
 *
 * Gateway READ-path (Bearer server token, same auth as ingest). Embeds the query
 * hub-side and returns top-k semantic neighbours from the org's corpus so the
 * gateway never needs an embeddings key. Returns an empty hit list (200) when
 * embeddings are unavailable or inputs are missing, so the gateway degrades
 * gracefully instead of erroring the agent turn.
 */
export const POST: RequestHandler = async ({ locals, request }) => {
  if (!locals.tenantCtx) throw error(401, 'Unauthorized');
  const orgId = locals.tenantCtx.tenantId;

  const body = (await request.json().catch(() => ({}))) as {
    agentId?: string;
    query?: string;
    limit?: number;
    /** Exact metadata key/value filter (e.g. {key:'dni', value:'10728921'}) */
    metadataFilter?: { key: string; value: string };
  };
  const agentId = typeof body.agentId === 'string' ? body.agentId.trim() : '';
  const query = typeof body.query === 'string' ? body.query.trim() : '';
  if (!agentId || !query || !embeddingsEnabled()) {
    return json({ hits: [] });
  }

  let queryEmbedding: number[];
  try {
    queryEmbedding = await embedText(query);
  } catch {
    // Best-effort: a failing embeddings provider must not break the agent turn.
    return json({ hits: [] });
  }

  const limit = typeof body.limit === 'number' && body.limit > 0 ? Math.min(body.limit, 50) : 5;
  const metadataFilter =
    body.metadataFilter &&
    typeof body.metadataFilter.key === 'string' &&
    typeof body.metadataFilter.value === 'string'
      ? { key: body.metadataFilter.key.trim(), value: body.metadataFilter.value.trim() }
      : undefined;
  const hits = await searchMemories(orgId, { agentId, queryEmbedding, limit, metadataFilter });
  return json({ hits });
};
