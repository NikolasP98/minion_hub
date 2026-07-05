import { error } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { supabaseAdmin } from '$server/supabase';
import { getCoreDb } from '$server/db/pg-client';
import { brains } from '$server/db/pg-schema/brains';
import { resolveCapabilities, type Capabilities } from '$server/services/rbac.service';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Managing-agent id pattern for AI-Brains agents (`deriveBrainAgentId` in
 *  brain-agents.service.ts) — `brain-<brainUuid>`. */
const BRAIN_AGENT_RE =
	/^brain-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

export interface AssistantPrincipal {
	/** Supabase profile uuid of the agent's owner, or (for a brain agent) the
	 *  brain agent's own gateway agentId — see `resolveBrainAgentPrincipal`. */
	principalId: string;
	/** Resolved org to scope to (membership-checked for personal agents; the
	 *  brain's own org for brain agents). */
	orgId: string;
	/** The principal's legacy org role ('admin' | 'owner' | 'member' | …), or
	 *  'agent' for a brain agent (never a real org role — can't collide). */
	role: string | null;
	/** Effective RBAC capabilities in that org — what the agent is allowed to do. */
	capabilities: Capabilities;
}

/**
 * Minimal, explicitly-built capability set for a brain-managing agent
 * (`brain-<uuid>`). Deliberately NOT derived from `resolveCapabilities`/a
 * fake profile — every module but `brains` is hard `false` so a brain agent
 * can list/search/remember on the brains it has `brain_access` grants for
 * (enforced separately by `canAccessBrain`) and nothing else: no CRM/finance
 * reads, no analytics SQL (`canRunAnalytics` is forced false even though
 * `brains` is itself a BUSINESS_MODULES entry), no comms/scheduling actions.
 */
function brainAgentCapabilities(): Capabilities {
	return {
		roles: [],
		can: (module, action) => module === 'brains' && (action === 'view' || action === 'edit'),
		canRunAnalytics: () => false,
		visibleModules: () => ['brains'],
		ownerScoped: () => false,
		fieldLevel: () => 0,
	};
}

/**
 * Resolve a `brain-<uuid>` agentId to its principal: org comes FROM the brain
 * row (`brains.agent_id`), looked up globally (no org filter — mirrors the
 * personal-agent `profiles.personal_agent_id` lookup below) since the request
 * carries no trusted org. No matching brain → fail closed, exactly like an
 * unknown personal agent id.
 */
async function resolveBrainAgentPrincipal(
	locals: App.Locals,
	agentId: string,
): Promise<AssistantPrincipal> {
	const [row] = await getCoreDb()
		.select({ orgId: brains.orgId })
		.from(brains)
		.where(eq(brains.agentId, agentId))
		.limit(1);
	if (!row) throw error(400, 'unresolvable principal');

	const isGateway = Boolean(locals.serverId);
	if (!isGateway) {
		if (!locals.user) throw error(401, 'Authentication required');
		if (locals.user.role !== 'admin' && locals.user.supabaseId !== agentId) {
			throw error(403, 'forbidden');
		}
	}

	return { principalId: agentId, orgId: row.orgId, role: 'agent', capabilities: brainAgentCapabilities() };
}

/**
 * Resolve + authorize the assistant caller for the gateway data endpoints
 * (/api/gateway/insight, /api/gateway/query, /api/gateway/brains*). Shared so
 * the security-critical auth can't drift between them.
 *
 * Trusted identity: a gateway caller passes the session's personal agent id
 * (`personal-<uuid>`); we resolve the owning profile via profiles.personal_agent_id
 * (authoritative, handles legacy non-uuid agent ids). A self/admin browser caller
 * may pass ?userId=<profile-uuid>. A `brain-<uuid>` agentId resolves to a
 * brains-only principal via `resolveBrainAgentPrincipal` instead (P4.2).
 *
 * Multi-org without bleed: `orgId` arrives through the (untrusted) model, so we
 * only honour it when the principal is actually a member — else fall back to their
 * primary org. They can never reach an org they don't belong to.
 */
export async function resolveAssistantPrincipal(
	locals: App.Locals,
	url: URL,
): Promise<AssistantPrincipal> {
	const agentId = url.searchParams.get('agentId');
	const userIdParam = url.searchParams.get('userId');
	if (!agentId && !userIdParam) throw error(400, 'agentId or userId query param required');

	if (agentId && BRAIN_AGENT_RE.test(agentId)) {
		return resolveBrainAgentPrincipal(locals, agentId);
	}

	const admin = supabaseAdmin();

	let principalId: string | null = null;
	if (agentId) {
		const { data } = await admin
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

	const { data: mems } = await admin
		.from('organization_members')
		.select('organization_id, role')
		.eq('profile_id', principalId);
	const rows = (mems ?? []) as Array<{ organization_id: string; role: string | null }>;
	if (rows.length === 0) throw error(404, 'no organization for user');

	const requested = url.searchParams.get('orgId');
	const chosen = (requested && rows.find((r) => r.organization_id === requested)) || rows[0];
	const capabilities = await resolveCapabilities(chosen.organization_id, principalId);
	return { principalId, orgId: chosen.organization_id, role: chosen.role, capabilities };
}
