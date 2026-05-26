import type { RequestHandler } from '@sveltejs/kit';
import { json } from '@sveltejs/kit';
import { requireAdmin } from '$server/auth/authorize';
import { denyRequest } from '$server/services/join/requests.service';

export const POST: RequestHandler = async ({ locals, params }) => {
	const admin = requireAdmin(locals);
	await denyRequest(params.id!, admin.id);
	return json({ ok: true });
};
