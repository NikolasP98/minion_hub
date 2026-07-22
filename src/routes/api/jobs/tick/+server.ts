import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { runTick } from '$server/services/bg-runtime';
// Importing the service registers its bg-runtime handler (side effect).
import '$server/services/groupchat.service';
import '$server/services/brains.service';
import '$server/services/brain-corpus-jobs.service';
import '$server/services/brain-business-corpus-jobs.service';

/**
 * GET /api/jobs/tick — cron entrypoint for the GLOBAL background-job runtime.
 * Bearer $CRON_SECRET. Advances every resumable bg_jobs row within a budget so
 * long-running work (group chat, future jobs) survives navigation.
 * Wire on netcup: per-minute crontab line hitting this URL with the secret
 * (same shape as the other ticks). NOTE: this path must also be in the
 * hooks.server.ts unauth allowlist.
 */
export const GET: RequestHandler = async ({ request }) => {
	const secret = env.CRON_SECRET;
	if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) throw error(401);
	const res = await runTick(50_000);
	return json(res);
};
