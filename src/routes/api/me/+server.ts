import type { RequestHandler } from '@sveltejs/kit';
import { json } from '@sveltejs/kit';
import { requireAuth } from '$server/auth/authorize';

export const GET: RequestHandler = async ({ locals }) => {
	const user = requireAuth(locals);
	return json({
		id: user.id,
		email: user.email,
		displayName: user.displayName,
		role: user.role,
	});
};
