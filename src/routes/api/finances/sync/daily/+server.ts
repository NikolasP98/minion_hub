import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { getCoreDb } from '$server/db/pg-client';
import { enqueueJob, listEnabledSources } from '$server/services/finance-sync-jobs.service';
import { advanceJob } from '$server/services/finance-sync.service';

const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * GET /api/finances/sync/daily — external-scheduler entrypoint (run once/day, 3am).
 * Enqueues + advances a bounded 1-WEEK-window sync for every enabled source, across
 * all orgs. Never does a full history sweep — that stays a manual action on
 * /finances/settings. Any run that doesn't finish in-budget is picked up by the
 * per-minute `/tick` (the persisted cursor already encodes the window). Authenticates
 * via `Authorization: Bearer $CRON_SECRET`, same as `/tick`.
 */
export const GET: RequestHandler = async ({ request }) => {
  const secret = env.CRON_SECRET;
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) throw error(401);

  const sources = await listEnabledSources('susii');
  let started = 0;
  for (const s of sources) {
    const ctx = { db: getCoreDb(), tenantId: s.orgId };
    try {
      const job = await enqueueJob(ctx, s.provider);
      await advanceJob(ctx, job.id, { budgetMs: 50_000, recentWindowMs: ONE_WEEK_MS });
      started++;
    } catch (e) {
      console.error('[finance-sync] daily advanceJob failed', s.orgId, s.provider, e);
    }
  }
  return json({ started });
};
