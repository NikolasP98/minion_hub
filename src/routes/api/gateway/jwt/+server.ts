import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { issueGatewayJwt } from '$server/services/gateway-jwt.service';
import { requireAuth } from '$server/auth/authorize';
import { getTenantCtx } from '$server/auth/tenant-ctx';

/**
 * GET /api/gateway/jwt
 *
 * Issues a gateway JWT for the authenticated user.
 * Requires an active session (cookie auth).
 * The JWT includes userId, role, agentIds, and orgId claims.
 */
export const GET: RequestHandler = async ({ locals }) => {
	const authUser = requireAuth(locals);
	const ctx = await getTenantCtx(locals);
	if (!ctx) throw error(500, 'No tenant context');

	try {
		const result = await issueGatewayJwt(ctx, authUser.id);
		return json(result);
	} catch (e) {
		console.error('[GET /api/gateway/jwt]', e);
		return json(
			{ error: e instanceof Error ? e.message : 'Failed to issue JWT' },
			{ status: 500 },
		);
	}
};
