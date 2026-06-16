import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { requireAuth, requireAdmin } from '$server/auth/authorize';
import { createRequest, listPendingRequests } from '$server/services/join/requests.service';
import { listAllOrganizations } from '$server/services/organizations.service';

export const POST: RequestHandler = async ({ locals, request }) => {
	const user = requireAuth(locals);
	if (!user.supabaseId) throw error(400, 'supabase session required');
	const body = (await request.json().catch(() => ({}))) as { message?: string };
	const [defaultOrg] = await listAllOrganizations();
	if (!defaultOrg) throw error(500, 'no organization configured');
	const r = await createRequest(
		{ id: user.id, supabaseId: user.supabaseId, email: user.email, displayName: user.displayName },
		defaultOrg.id,
		body.message,
	);
	return json({ ok: true, id: r.id, status: r.status });
};

export const GET: RequestHandler = async ({ locals }) => {
	requireAdmin(locals);
	if (!locals.tenantCtx) throw error(401, 'tenant context required');
	return json({ requests: await listPendingRequests(locals.tenantCtx.tenantId) });
};
