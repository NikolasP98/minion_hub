import type { RequestHandler } from '@sveltejs/kit';
import { json, isHttpError } from '@sveltejs/kit';
import { z } from 'zod';
import { getCoreDb } from '$server/db/pg-client';
import { resolveAssistantPrincipal } from '$server/auth/assistant-principal';
import { parseBody } from '$server/api/validate';
import { searchBrainHybrid } from '$server/services/brain-hybrid-retrieval.service';
import type { CoreCtx } from '$server/auth/core-ctx';

const postSchema = z.object({
  brainId: z.string().uuid(),
  query: z.string().trim().min(1).max(2000),
  limit: z.number().int().positive().max(50).optional(),
  sourceIds: z.array(z.string().uuid()).max(50).optional(),
  connectors: z.array(z.string().trim().min(1).max(80)).max(20).optional(),
  kinds: z
    .array(z.enum(['summary', 'section', 'burst', 'code_file', 'code_symbol', 'raw']))
    .max(20)
    .optional(),
  metadata: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
  neighborRadius: z.number().int().min(0).max(3).optional(),
});

/**
 * POST /api/gateway/brain-search?agentId=personal-<uuid>[&orgId=<org>]
 *   body: { brainId, query, limit? }
 *
 * Hybrid lexical/vector search over one brain's evidence for the calling agent. Same
 * trusted-identity resolution as /api/gateway/insight; per-brain access is
 * enforced again inside searchBrainHybrid (fail-closed — an agent with no grant on
 * a private brain gets nothing, even if it somehow guesses the brain id).
 */
export const POST: RequestHandler = async ({ locals, url, request }) => {
  const { principalId, orgId, capabilities } = await resolveAssistantPrincipal(locals, url);
  if (!capabilities.can('brains', 'view')) {
    return json(
      { error: 'Your role does not permit reading this organization’s brains.' },
      { status: 403 },
    );
  }
  const ctx: CoreCtx = { db: getCoreDb(), tenantId: orgId, profileId: principalId };
  const agentId = url.searchParams.get('agentId');

  const body = await parseBody(request, postSchema);

  try {
    const result = await searchBrainHybrid(ctx, body.brainId, body.query, body, {
      profileId: principalId,
      agentId,
      roles: capabilities.roles,
    });
    return json({ orgId, brainId: body.brainId, ...result });
  } catch (e) {
    if (isHttpError(e)) return json({ error: e.body.message }, { status: e.status });
    const message = e instanceof Error ? e.message : 'search failed';
    return json({ error: message }, { status: 400 });
  }
};
