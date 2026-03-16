import type { RequestHandler } from '@sveltejs/kit';
import { json } from '@sveltejs/kit';
import { getTenantCtx } from '$server/auth/tenant-ctx';
import { createMigratedPersonalAgent } from '$server/services/personal-agent-migration';

/**
 * GET /api/admin/personal-agent-migration
 *
 * Returns migration guidance. The hub doesn't have direct access to gateway config,
 * so actual candidate detection happens on the gateway side. This endpoint instructs
 * the admin to run migration from the gateway CLI.
 */
export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user || locals.user.role !== 'admin') {
		return json({ error: 'Admin access required' }, { status: 403 });
	}

	return json({
		message: 'Run migration from gateway CLI: minion agents migrate-personal',
		candidates: [],
	});
};

/**
 * POST /api/admin/personal-agent-migration
 *
 * Create hub DB entries for already-migrated agents (gateway-side migration complete).
 * Called after the gateway-side migration completes (directory rename + symlink + config update).
 *
 * Body: { migrations: Array<{ userId, userName, serverId, originalName, newAgentId }> }
 * Returns: { results: Array<{ newAgentId, success, error? }> }
 */
export const POST: RequestHandler = async ({ locals, request }) => {
	if (!locals.user || locals.user.role !== 'admin') {
		return json({ error: 'Admin access required' }, { status: 403 });
	}

	const ctx = await getTenantCtx(locals);
	if (!ctx) {
		return json({ error: 'Authentication required' }, { status: 401 });
	}

	const body = await request.json();

	if (!Array.isArray(body.migrations)) {
		return json({ error: 'migrations must be an array' }, { status: 400 });
	}

	const results: Array<{ newAgentId: string; success: boolean; error?: string }> = [];

	for (const migration of body.migrations) {
		const { userId, userName, serverId, originalName, newAgentId } = migration;

		if (!userId || !userName || !serverId || !originalName || !newAgentId) {
			results.push({
				newAgentId: newAgentId ?? 'unknown',
				success: false,
				error: 'Missing required fields: userId, userName, serverId, originalName, newAgentId',
			});
			continue;
		}

		try {
			await createMigratedPersonalAgent(ctx, {
				userId,
				userName,
				serverId,
				originalName,
				newAgentId,
			});
			results.push({ newAgentId, success: true });
		} catch (err) {
			results.push({
				newAgentId,
				success: false,
				error: err instanceof Error ? err.message : String(err),
			});
		}
	}

	return json({ results });
};
