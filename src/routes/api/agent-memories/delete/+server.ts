import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { deleteMemoriesBySource } from '$server/services/agent-memories.service';

/**
 * POST /api/agent-memories/delete  { agentId, source, sourceId }
 *
 * Gateway delete-cascade (Bearer server token, same auth as ingest/recall).
 * Removes corpus rows mirrored from a now-deleted source object (e.g. a KG node
 * that was `forget`-ten) so the corpus doesn't accumulate orphaned vectors.
 */
export const POST: RequestHandler = async ({ locals, request }) => {
  if (!locals.tenantCtx) throw error(401, 'Unauthorized');
  const orgId = locals.tenantCtx.tenantId;

  const body = (await request.json().catch(() => ({}))) as {
    agentId?: string;
    source?: string;
    sourceId?: string;
  };
  const agentId = typeof body.agentId === 'string' ? body.agentId.trim() : '';
  const source = typeof body.source === 'string' ? body.source.trim() : '';
  const sourceId = typeof body.sourceId === 'string' ? body.sourceId.trim() : '';
  if (!agentId || !source || !sourceId) {
    return json({ ok: true, deleted: 0 });
  }

  const deleted = await deleteMemoriesBySource(orgId, { agentId, source, sourceId });
  return json({ ok: true, deleted });
};
