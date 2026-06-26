import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { getCoreDb } from '$server/db/pg-client';
import { rankCustomers } from '$server/services/crm-finance.service';
import { resolveAssistantPrincipal } from '$server/auth/assistant-principal';
import type { CoreCtx } from '$server/auth/core-ctx';

/**
 * GET /api/gateway/insight?agentId=personal-<uuid>&orgId=<org>&intent=top_customers&limit=5
 *   (or ?userId=<profile-uuid> for self/admin browser callers)
 *
 * On-the-fly analytical answers for the floating assistant (e.g. "who has the
 * highest ticket?"). The hub runs the org-scoped query and returns structured
 * rows the agent formats with evidence links.
 *
 * SECURITY — trusted identity: the gateway passes the session's `agentId`, NOT a
 * model-chosen user id. A personal agent id is `personal-<profile-uuid>`
 * (derivePersonalAgentId), so the owning user is derivable from the agent id the
 * gateway already holds. This inherits the existing chat trust model (whoever may
 * chat as this personal agent is its owner) without widening it, and the endpoint
 * is read-only.
 *
 * SECURITY — multi-org without bleed: `orgId` arrives through the agent (model
 * output), so it is UNTRUSTED. We resolve the set of orgs the principal is
 * actually a member of (organization_members.profile_id) and require the
 * requested org to be in that set, defaulting to the primary org otherwise. So
 * the worst a malicious/injected orgId can do is query the user's OWN other org —
 * never a stranger's. withOrgCore then enforces RLS on the resolved org.
 */
export const GET: RequestHandler = async ({ locals, url }) => {
  const { principalId, orgId, capabilities } = await resolveAssistantPrincipal(locals, url);
  // RBAC: top customers / recent buyers read CRM + finance.
  if (!capabilities.can('crm', 'view') && !capabilities.can('finance', 'view')) {
    return json({ error: 'Your role does not permit reading customer data.' }, { status: 403 });
  }
  const ctx: CoreCtx = { db: getCoreDb(), tenantId: orgId, profileId: principalId };

  const intent = url.searchParams.get('intent') ?? 'top_customers';
  const limit = Number(url.searchParams.get('limit') ?? 5);

  try {
    if (intent === 'top_customers' || intent === 'recent_buyers') {
      const customers = await rankCustomers(
        ctx,
        intent === 'recent_buyers' ? 'recency' : 'revenue',
        limit,
      );
      return json({ orgId, intent, customers });
    }
    throw error(400, `unknown intent: ${intent}`);
  } catch (e) {
    if (e instanceof Response) throw e;
    console.error('[GET /api/gateway/insight]', e);
    return json({ error: e instanceof Error ? e.message : 'Unknown error' }, { status: 500 });
  }
};
