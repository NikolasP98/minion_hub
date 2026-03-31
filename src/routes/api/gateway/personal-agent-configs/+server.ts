import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { personalAgents } from '$server/db/schema/personal-agents';
import { eq } from 'drizzle-orm';
import { getTenantCtx } from '$server/auth/tenant-ctx';

/**
 * GET /api/gateway/personal-agent-configs
 *
 * Returns display configs for all active personal agents.
 * Used by the hub client to sync personal agent displayNames to the gateway
 * after reconnection (the gateway's in-memory cache is volatile).
 */
export const GET: RequestHandler = async ({ locals }) => {
	const ctx = await getTenantCtx(locals);
	if (!ctx) throw error(401, 'Authentication required');

	try {
		const rows = await ctx.db
			.select({
				agentId: personalAgents.agentId,
				displayName: personalAgents.displayName,
				avatarUrl: personalAgents.avatarUrl,
			})
			.from(personalAgents)
			.where(eq(personalAgents.provisioningStatus, 'active'));

		return json({ configs: rows });
	} catch (e) {
		console.error('[GET /api/gateway/personal-agent-configs]', e);
		return json(
			{ error: e instanceof Error ? e.message : 'Unknown error' },
			{ status: 500 },
		);
	}
};
