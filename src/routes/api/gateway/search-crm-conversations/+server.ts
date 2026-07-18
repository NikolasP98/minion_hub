import type { RequestHandler } from '@sveltejs/kit';
import { json, error, isHttpError } from '@sveltejs/kit';
import { getCoreDb } from '$server/db/pg-client';
import { resolveAssistantPrincipal } from '$server/auth/assistant-principal';
import { embedText } from '$server/services/embeddings';
import { similarConversations } from '$server/services/crm-conversation-vectors.service';
import type { CoreCtx } from '$server/auth/core-ctx';

/**
 * POST /api/gateway/search-crm-conversations?agentId=personal-<uuid>[&orgId=<org>]
 *   body: { query, k? }
 *
 * Semantic top-k retrieval over `crm_conversation_chunks` (spec
 * 2026-07-17 §2 WP-B) — mirrors /api/gateway/brain-search's shape.
 * Answers TARGETED conversation questions ("what did people say about
 * pricing?"); see crm-conversation-themes for census/aggregate questions.
 */
export const POST: RequestHandler = async ({ locals, url, request }) => {
  const { principalId, orgId, capabilities } = await resolveAssistantPrincipal(locals, url);
  if (!capabilities.can('crm', 'view')) {
    return json({ error: 'Your role does not permit reading this organization’s CRM data.' }, { status: 403 });
  }
  const ctx: CoreCtx = { db: getCoreDb(), tenantId: orgId, profileId: principalId };

  const body = (await request.json().catch(() => ({}))) as { query?: unknown; k?: unknown };
  const query = typeof body.query === 'string' ? body.query : '';
  const k = Math.min(25, Math.max(1, typeof body.k === 'number' ? Math.floor(body.k) : 8));
  if (!query.trim()) throw error(400, 'query is required');

  try {
    const vec = await embedText(query);
    const hits = await similarConversations(ctx, vec, k);
    return json({ orgId, hits });
  } catch (e) {
    if (isHttpError(e)) return json({ error: e.body.message }, { status: e.status });
    const message = e instanceof Error ? e.message : 'search failed';
    return json({ error: message }, { status: 400 });
  }
};
