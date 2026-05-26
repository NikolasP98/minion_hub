import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { requireAdmin } from '$server/auth/authorize';
import { approveRequest } from '$server/services/join/requests.service';

export const POST: RequestHandler = async ({ locals, params, request }) => {
	const admin = requireAdmin(locals);
	const body = (await request.json().catch(() => ({}))) as { role?: string; organizationId?: string };
	if (!body.organizationId) throw error(400, 'organizationId required');
	await approveRequest(params.id!, {
		reviewerId: admin.id,
		role: body.role ?? 'user',
		organizationId: body.organizationId,
	});
	return json({ ok: true });
};
