import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { upsertMemories, type MemoryInput } from '$server/services/agent-memories.service';
import { embedTexts, embeddingsEnabled } from '$server/services/embeddings';

/**
 * POST /api/agent-memories/ingest  { rows: MemoryInput[] }
 *
 * Gateway write-path. Authenticated via the Bearer server token (same as the
 * message ledger ingest — resolveViaMetricsBearer sets tenantCtx + serverId).
 * Embeddings are computed server-side here so the gateway doesn't need an
 * OpenAI key. Idempotent on (org, source, source_id).
 */
export const POST: RequestHandler = async ({ locals, request }) => {
  if (!locals.tenantCtx) throw error(401, 'Unauthorized');
  const orgId = locals.tenantCtx.tenantId;
  const serverId = (locals as Record<string, unknown>).serverId as string | undefined;

  const body = (await request.json()) as { rows?: MemoryInput[] };
  const rows = (Array.isArray(body.rows) ? body.rows : []).filter(
    (r): r is MemoryInput => typeof r?.content === 'string' && r.content.length > 0 && !!r.agentId,
  );
  if (rows.length === 0) return json({ ok: true, accepted: 0 });

  // Compute embeddings for rows that didn't ship one. Best-effort: if embeddings
  // are unavailable, store the memory without a vector (searchable later via backfill).
  if (embeddingsEnabled()) {
    const needEmbed = rows.filter((r) => !r.embedding);
    if (needEmbed.length > 0) {
      const vecs = await embedTexts(needEmbed.map((r) => r.content));
      needEmbed.forEach((r, i) => {
        r.embedding = vecs[i];
      });
    }
  }

  const accepted = await upsertMemories(
    orgId,
    rows.map((r) => ({ ...r, gatewayId: r.gatewayId ?? serverId ?? null })),
  );
  return json({ ok: true, accepted });
};
