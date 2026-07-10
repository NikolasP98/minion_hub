import type { RequestHandler } from '@sveltejs/kit';
import { json } from '@sveltejs/kit';
import { resolveAssistantPrincipal } from '$server/auth/assistant-principal';
import { MODULES, ACTIONS, type Module, type PermAction } from '$server/services/rbac.service';

/**
 * GET /api/gateway/query/tool-permissions?agentId=personal-<uuid>[&orgId=]
 *
 * The hub capability snapshot the gateway's L1 RBAC gate fetches (spec C2) —
 * this endpoint IS the capability read, so unlike every other /api/gateway
 * endpoint it carries NO capability gate of its own (there's nothing left to
 * gate: it just serializes what `resolveAssistantPrincipal` already resolved).
 */
export const GET: RequestHandler = async ({ locals, url }) => {
	const { principalId, orgId, role, capabilities } = await resolveAssistantPrincipal(locals, url);

	const modules: Partial<Record<Module, PermAction[]>> = {};
	for (const module of MODULES) {
		const allowed = ACTIONS.filter((action) => capabilities.can(module, action));
		if (allowed.length > 0) modules[module] = allowed;
	}

	return json({ principalId, orgId, role, modules });
};
