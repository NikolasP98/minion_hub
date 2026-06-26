import { error } from '@sveltejs/kit';
import { supabaseAdmin } from '$server/supabase';
import { resolveCapabilities, type Capabilities } from '$server/services/rbac.service';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface AssistantPrincipal {
	/** Supabase profile uuid of the agent's owner. */
	principalId: string;
	/** Resolved org to scope to (membership-checked). */
	orgId: string;
	/** The principal's legacy org role ('admin' | 'owner' | 'member' | …). */
	role: string | null;
	/** Effective RBAC capabilities in that org — what the agent is allowed to do. */
	capabilities: Capabilities;
}

/**
 * Resolve + authorize the assistant caller for the gateway data endpoints
 * (/api/gateway/insight, /api/gateway/query). Shared so the security-critical
 * auth can't drift between them.
 *
 * Trusted identity: a gateway caller passes the session's personal agent id
 * (`personal-<uuid>`); we resolve the owning profile via profiles.personal_agent_id
 * (authoritative, handles legacy non-uuid agent ids). A self/admin browser caller
 * may pass ?userId=<profile-uuid>.
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
