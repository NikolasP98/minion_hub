import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { requireAdmin } from '$server/auth/authorize';
import {
	setRoleOverride,
	clearRoleOverride,
	isModule,
	ACTIONS,
	type ActionSet,
	type PermAction,
} from '$server/services/rbac.service';

/**
 * Role Permission Manager writes — per-org capability overrides for a built-in
 * role. POST upserts the (role, module) ActionSet; DELETE reverts it to the code
 * default. Admin-only; org scope = the caller's active org.
 */

function parseCaps(raw: unknown): ActionSet {
	const c = (raw ?? {}) as Record<string, unknown>;
	const out = {} as ActionSet;
	for (const a of ACTIONS) out[a as PermAction] = c[a] === true;
	return out;
}

export const POST: RequestHandler = async ({ locals, request }) => {
	requireAdmin(locals);
	if (!locals.tenantCtx) throw error(401);
	const b = (await request.json().catch(() => ({}))) as {
		roleKey?: string;
		module?: string;
		caps?: unknown;
	};
	if (!b.roleKey || !isModule(b.module)) throw error(400, 'roleKey and valid module required');
	await setRoleOverride(locals.tenantCtx.tenantId, b.roleKey, b.module, parseCaps(b.caps));
	return json({ ok: true });
};

export const DELETE: RequestHandler = async ({ locals, request }) => {
	requireAdmin(locals);
	if (!locals.tenantCtx) throw error(401);
	const b = (await request.json().catch(() => ({}))) as { roleKey?: string; module?: string };
	if (!b.roleKey || !isModule(b.module)) throw error(400, 'roleKey and valid module required');
	await clearRoleOverride(locals.tenantCtx.tenantId, b.roleKey, b.module);
	return json({ ok: true });
};
