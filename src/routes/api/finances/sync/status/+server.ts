import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { getCoreCtx } from '$server/auth/core-ctx';
import { getActiveJob, getLatestJob, isJobStale } from '$server/services/finance-sync-jobs.service';

/** GET /api/finances/sync/status?provider= — current/last job for the UI poller. */
export const GET: RequestHandler = async ({ locals, url }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  const provider = url.searchParams.get('provider') ?? 'susii';
  const job = (await getActiveJob(ctx, provider)) ?? (await getLatestJob(ctx, provider));
  // A frozen worker leaves `running` on the row forever, so status alone would
  // report "syncing" indefinitely and the UI would disable the Sync button —
  // the exact control that recovers it (claimJob re-claims a stale running
  // job, resuming from the persisted cursor). Stale ⇒ not active, and
  // `stalled` lets the UI say "resume" rather than "running".
  const stalled = job ? isJobStale(job) : false;
  return json({
    active: job ? (job.status === 'queued' || job.status === 'running') && !stalled : false,
    stalled,
    status: job?.status ?? null,
    total: job?.total ?? null,
    processed: job?.processed ?? 0,
    error: job?.error ?? null,
    startedAt: job?.startedAt ?? null,
    finishedAt: job?.finishedAt ?? null,
  });
};
