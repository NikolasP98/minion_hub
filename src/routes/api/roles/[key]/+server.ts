import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { deleteCustomRole, requireOrgCapability } from '$server/services/rbac.service';

/**
 * DELETE /api/roles/[key] — remove an org's custom role. Gated `users:manage`.
 * `deleteCustomRole` 404s for a key this org never created (including system
 * role keys) and 409s while any member still holds it.
 */
export const DELETE: RequestHandler = async ({ locals, params }) => {
	await requireOrgCapability(locals, 'users', 'manage');
	if (!locals.tenantCtx) throw error(401);
	const key = params.key;
	if (!key) throw error(400, 'role key required');
	await deleteCustomRole(locals.tenantCtx.tenantId, key);
	return json({ ok: true });
};
