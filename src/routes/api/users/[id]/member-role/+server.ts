import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { requireOrgCapability, setMemberRole, isRoleKey } from '$server/services/rbac.service';

/**
 * PATCH /api/users/[id]/member-role  body: { roleKey }
 *
 * Assign a member's RBAC role in the caller's active org (Team page). Gated on
 * can('users','manage'). Single-role: replaces the member's existing role(s) in
 * this org with `roleKey`.
 */
export const PATCH: RequestHandler = async ({ locals, params, request }) => {
	await requireOrgCapability(locals, 'users', 'manage');
	if (!locals.tenantCtx) throw error(401, 'tenant context required');
	const profileId = params.id;
	if (!profileId) throw error(400, 'user id required');

	const b = (await request.json().catch(() => ({}))) as { roleKey?: unknown };
	if (!isRoleKey(b.roleKey)) throw error(400, 'valid roleKey required');

	await setMemberRole(locals.tenantCtx.tenantId, profileId, b.roleKey, locals.user?.supabaseId ?? null);
	return json({ ok: true, roleKey: b.roleKey });
};
