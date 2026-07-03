import type { RequestHandler } from '@sveltejs/kit';
import { json, error, isHttpError } from '@sveltejs/kit';
import { getCoreDb } from '$server/db/pg-client';
import { resolveAssistantPrincipal } from '$server/auth/assistant-principal';
import { searchBrain } from '$server/services/brains.service';
import type { CoreCtx } from '$server/auth/core-ctx';

/**
 * POST /api/gateway/brain-search?agentId=personal-<uuid>[&orgId=<org>]
 *   body: { brainId, query, limit? }
 *
 * Semantic search over one brain's chunks for the calling agent. Same
 * trusted-identity resolution as /api/gateway/insight; per-brain access is
 * enforced again inside searchBrain (fail-closed — an agent with no grant on
 * a private brain gets nothing, even if it somehow guesses the brain id).
 */
export const POST: RequestHandler = async ({ locals, url, request }) => {
  const { principalId, orgId, capabilities } = await resolveAssistantPrincipal(locals, url);
  if (!capabilities.can('brains', 'view')) {
    return json({ error: 'Your role does not permit reading this organization’s brains.' }, { status: 403 });
  }
  const ctx: CoreCtx = { db: getCoreDb(), tenantId: orgId, profileId: principalId };
  const agentId = url.searchParams.get('agentId');

  const body = (await request.json().catch(() => ({}))) as { brainId?: unknown; query?: unknown; limit?: unknown };
  const brainId = typeof body.brainId === 'string' ? body.brainId : '';
  const query = typeof body.query === 'string' ? body.query : '';
  const limit = typeof body.limit === 'number' ? body.limit : undefined;
  if (!brainId || !query.trim()) throw error(400, 'brainId and query are required');

  try {
    const hits = await searchBrain(ctx, brainId, query, limit, { profileId: principalId, agentId, roles: capabilities.roles });
    return json({ orgId, brainId, hits });
  } catch (e) {
    if (isHttpError(e)) return json({ error: e.body.message }, { status: e.status });
    const message = e instanceof Error ? e.message : 'search failed';
    return json({ error: message }, { status: 400 });
  }
};
