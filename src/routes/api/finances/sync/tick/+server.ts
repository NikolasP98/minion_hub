import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { getCoreDb } from '$server/db/pg-client';
import { findResumableJobs } from '$server/services/finance-sync-jobs.service';
import { advanceJob } from '$server/services/finance-sync.service';

/**
 * GET /api/finances/sync/tick — Vercel Cron entrypoint (every minute). Resumes
 * any queued/stalled job in a bounded chunk so syncs converge regardless of user
 * presence and recover from a dead worker. Vercel sends `Authorization: Bearer
 * $CRON_SECRET` automatically for configured crons; reject anything else.
 */
export const GET: RequestHandler = async ({ request }) => {
  const secret = env.CRON_SECRET;
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) throw error(401);
  const jobs = await findResumableJobs(3);
  let advanced = 0;
  for (const j of jobs) {
    const ctx = { db: getCoreDb(), tenantId: j.orgId };
    try {
      await advanceJob(ctx, j.jobId, { budgetMs: 50_000 });
      advanced++;
    } catch (e) {
      console.error('[finance-sync] tick advanceJob failed', j.jobId, e);
    }
  }
  return json({ advanced });
};
