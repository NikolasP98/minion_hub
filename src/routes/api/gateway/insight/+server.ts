import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { supabaseAdmin } from '$server/supabase';
import { getCoreDb } from '$server/db/pg-client';
import { rankCustomers } from '$server/services/crm-finance.service';
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
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const GET: RequestHandler = async ({ locals, url }) => {
  const agentId = url.searchParams.get('agentId');
  const userIdParam = url.searchParams.get('userId');
  if (!agentId && !userIdParam) throw error(400, 'agentId or userId query param required');

  // The principal is the Supabase profile uuid. A gateway caller passes the
  // (trusted) personal agent id — resolve the owning profile by its stored
  // personal_agent_id (authoritative; handles uuid-derived AND legacy agent ids,
  // unlike stripping the `personal-` prefix). A self/admin browser caller may
  // pass the profile uuid directly.
  let principalId: string | null = null;
  if (agentId) {
    const { data } = await supabaseAdmin()
      .from('profiles')
      .select('id')
      .eq('personal_agent_id', agentId)
      .maybeSingle();
    principalId = (data as { id: string } | null)?.id ?? null;
  } else if (userIdParam && UUID_RE.test(userIdParam)) {
    principalId = userIdParam;
  }
  if (!principalId) throw error(400, 'unresolvable principal');

  const isGateway = Boolean(locals.serverId);
  if (!isGateway) {
    if (!locals.user) throw error(401, 'Authentication required');
    if (locals.user.role !== 'admin' && locals.user.supabaseId !== principalId) {
      throw error(403, 'forbidden');
    }
  }

  // Orgs the principal is actually a member of — the authorization allowlist.
  const { data: mems } = await supabaseAdmin()
    .from('organization_members')
    .select('organization_id')
    .eq('profile_id', principalId);
  const memberOrgIds = (mems ?? [])
    .map((m) => (m as { organization_id: string }).organization_id)
    .filter(Boolean);
  if (memberOrgIds.length === 0) return json({ error: 'no organization for user' }, { status: 404 });

  const requested = url.searchParams.get('orgId');
  // Honour the requested org only if the principal belongs to it; else fall back
  // to their primary (first) org. Never query an org they aren't a member of.
  const orgId = requested && memberOrgIds.includes(requested) ? requested : memberOrgIds[0];

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
