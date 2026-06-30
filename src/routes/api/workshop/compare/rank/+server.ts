import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { saveRanking } from '$server/services/workshop-experiments.service';

// Persist a user ranking (best-first model ids) + category tags for a run.
export const POST: RequestHandler = async ({ locals, request }) => {
	if (!locals.tenantCtx) throw error(401);
	const b = (await request.json().catch(() => ({}))) as {
		runId?: string;
		rankedModelIds?: string[];
		categories?: string[];
	};
	if (!b.runId || !Array.isArray(b.rankedModelIds)) throw error(400, 'runId and rankedModelIds required');
	try {
		await saveRanking(
			{ tenantId: locals.tenantCtx.tenantId },
			locals.user?.id ?? null,
			b.runId,
			b.rankedModelIds,
			Array.isArray(b.categories) ? b.categories : [],
		);
	} catch (e) {
		throw error(404, e instanceof Error ? e.message : 'run not found');
	}
	return json({ ok: true });
};
