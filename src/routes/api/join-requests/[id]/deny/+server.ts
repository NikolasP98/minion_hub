import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { requireAdmin } from '$server/auth/authorize';
import { denyRequest } from '$server/services/join/requests.service';

export const POST: RequestHandler = async ({ locals, params }) => {
	const admin = requireAdmin(locals);
	if (!locals.tenantCtx) throw error(401, 'tenant context required');
	// Scope the deny to the admin's own org so it can't resolve another tenant's request.
	await denyRequest(params.id!, { reviewerId: admin.id, organizationId: locals.tenantCtx.tenantId });
	return json({ ok: true });
};
