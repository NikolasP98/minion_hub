import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import {
	requireOrgCapability,
	setMemberRole,
	addMemberRole,
	removeMemberRole,
	isRoleKey,
} from '$server/services/rbac.service';

/**
 * PATCH /api/users/[id]/member-role  body: { roleKey }
 *
 * Assign a member's RBAC role in the caller's active org (Team page). Gated on
 * can('users','manage'). Single-role: replaces the member's existing role(s) in
 * this org with `roleKey`. Kept for back-compat; POST/DELETE below are the
 * multi-role add/remove used by the chip UI.
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

/**
 * POST /api/users/[id]/member-role  body: { roleKey }
 *
 * Add one role to a member without touching their other roles (multi-role).
 */
export const POST: RequestHandler = async ({ locals, params, request }) => {
	await requireOrgCapability(locals, 'users', 'manage');
	if (!locals.tenantCtx) throw error(401, 'tenant context required');
	const profileId = params.id;
	if (!profileId) throw error(400, 'user id required');

	const b = (await request.json().catch(() => ({}))) as { roleKey?: unknown };
	if (!isRoleKey(b.roleKey)) throw error(400, 'valid roleKey required');

	await addMemberRole(locals.tenantCtx.tenantId, profileId, b.roleKey, locals.user?.supabaseId ?? null);
	return json({ ok: true, roleKey: b.roleKey });
};

/**
 * DELETE /api/users/[id]/member-role  body: { roleKey }
 *
 * Remove one role from a member (multi-role). Refuses to strip an org's last
 * `owner` role (see removeMemberRole).
 */
export const DELETE: RequestHandler = async ({ locals, params, request }) => {
	await requireOrgCapability(locals, 'users', 'manage');
	if (!locals.tenantCtx) throw error(401, 'tenant context required');
	const profileId = params.id;
	if (!profileId) throw error(400, 'user id required');

	const b = (await request.json().catch(() => ({}))) as { roleKey?: unknown };
	if (!isRoleKey(b.roleKey)) throw error(400, 'valid roleKey required');

	await removeMemberRole(locals.tenantCtx.tenantId, profileId, b.roleKey);
	return json({ ok: true, roleKey: b.roleKey });
};
