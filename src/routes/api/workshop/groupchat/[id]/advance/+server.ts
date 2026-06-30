import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { and, eq, inArray } from 'drizzle-orm';
import { getCoreDb } from '$server/db/pg-client';
import { bgJobs } from '$server/db/pg-schema/bg-jobs';
import { advanceJob } from '$server/services/bg-runtime';
// Registers the groupchat handler.
import '$server/services/groupchat.service';

// On-demand advance while the page is open — snappier than waiting for the cron
// tick. Durability still comes from the cron tick when the page is closed.
export const POST: RequestHandler = async ({ locals, params }) => {
	if (!locals.tenantCtx) throw error(401);
	const [job] = await getCoreDb()
		.select({ id: bgJobs.id })
		.from(bgJobs)
		.where(
			and(
				eq(bgJobs.refId, params.id!),
				eq(bgJobs.tenantId, locals.tenantCtx.tenantId),
				inArray(bgJobs.status, ['queued', 'running']),
			),
		)
		.limit(1);
	if (!job) return json({ advanced: false });
	// Short budget: do a couple of turns then return so the UI can re-poll.
	await advanceJob(job.id, 20_000);
	return json({ advanced: true });
};
