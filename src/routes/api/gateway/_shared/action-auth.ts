import { error } from '@sveltejs/kit';
import { getCoreDb } from '$server/db/pg-client';
import { supabaseAdmin } from '$server/supabase';
import { resolveAssistantPrincipal } from '$server/auth/assistant-principal';
import type { CoreCtx } from '$server/auth/core-ctx';
import type { Capabilities, Module, PermAction } from '$server/services/rbac.service';

export interface ActionAuth {
	ctx: CoreCtx;
	orgId: string;
	principalId: string;
	capabilities: Capabilities;
}

/**
 * Shared plumbing for every /api/gateway/actions/* and /api/gateway/query/*
 * route: resolve the trusted assistant principal (see
 * `$server/auth/assistant-principal` SECURITY comments) into an org-scoped
 * CoreCtx, then require the RBAC capability the endpoint needs. 403s with a
 * message the agent can relay to the user rather than a bare status code.
 */
export async function requireAssistantCapability(
	locals: App.Locals,
	url: URL,
	module: Module | string,
	action: PermAction,
): Promise<ActionAuth> {
	const { principalId, orgId, capabilities } = await resolveAssistantPrincipal(locals, url);
	if (!capabilities.can(module, action)) {
		throw error(403, `Your role does not permit '${action}' on ${module}.`);
	}
	return { ctx: { db: getCoreDb(), tenantId: orgId, profileId: principalId }, orgId, principalId, capabilities };
}

/**
 * Actor stamp for service audit trails: "<display name or email> (via agent)"
 * per the plan's audit-actor convention, so agent-driven writes are
 * attributable to the human who owns the personal agent, not anonymous.
 */
export async function agentActor(
	principalId: string,
): Promise<{ id: string; name: string; email?: string | null }> {
	const { data } = await supabaseAdmin()
		.from('profiles')
		.select('display_name, email')
		.eq('id', principalId)
		.maybeSingle();
	const profile = data as { display_name: string | null; email: string } | null;
	const label = profile?.display_name || profile?.email || principalId;
	return { id: principalId, name: `${label} (via agent)`, email: profile?.email ?? null };
}
