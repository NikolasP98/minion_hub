import type { RequestHandler } from '@sveltejs/kit';
import { json } from '@sveltejs/kit';
import { getCoreDb } from '$server/db/pg-client';
import { resolveAssistantPrincipal } from '$server/auth/assistant-principal';
import { listBrains } from '$server/services/brains.service';
import type { CoreCtx } from '$server/auth/core-ctx';

/**
 * GET /api/gateway/brains?agentId=personal-<uuid>[&orgId=<org>]
 *
 * List the brains the calling agent's owner can read — the `query/brains`
 * lookup a gateway tool calls before `brain-search`/`brain-remember` when it
 * doesn't already know which brain to target. Same trusted-identity resolution
 * as /api/gateway/insight and /api/gateway/query.
 */
export const GET: RequestHandler = async ({ locals, url }) => {
  const { principalId, orgId, capabilities } = await resolveAssistantPrincipal(locals, url);
  if (!capabilities.can('brains', 'view')) {
    return json({ error: 'Your role does not permit reading this organization’s brains.' }, { status: 403 });
  }
  const ctx: CoreCtx = { db: getCoreDb(), tenantId: orgId, profileId: principalId };
  const agentId = url.searchParams.get('agentId');
  const brains = await listBrains(ctx, { profileId: principalId, agentId, roles: capabilities.roles });
  return json({ orgId, brains });
};
