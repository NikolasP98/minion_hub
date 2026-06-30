import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { getLeaderboard } from '$server/services/workshop-experiments.service';

// Model leaderboard for the active org: win-rates from rankings + latency/cost
// aggregates from comparison outputs.
export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.tenantCtx) throw error(401);
	const rows = await getLeaderboard({ tenantId: locals.tenantCtx.tenantId });
	return json({ rows });
};
