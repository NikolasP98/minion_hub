import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { listChannelIdentities } from '$server/services/channel-identity.service';
import { getTenantCtx } from '$server/auth/tenant-ctx';

/**
 * GET /api/gateway/channel-identities
 *
 * Returns all channel identity mappings for gateway startup fetch.
 * Protected by server token auth (Bearer token from gateway) or admin session.
 */
export const GET: RequestHandler = async ({ locals }) => {
	const ctx = await getTenantCtx(locals);
	if (!ctx) throw error(401, 'Authentication required');

	try {
		const identities = await listChannelIdentities(ctx);
		return json({ identities });
	} catch (e) {
		console.error('[GET /api/gateway/channel-identities]', e);
		return json(
			{ error: e instanceof Error ? e.message : 'Unknown error' },
			{ status: 500 },
		);
	}
};
