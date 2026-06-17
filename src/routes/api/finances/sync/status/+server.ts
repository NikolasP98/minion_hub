import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { getCoreCtx } from '$server/auth/core-ctx';
import { getActiveJob, getLatestJob } from '$server/services/finance-sync-jobs.service';

/** GET /api/finances/sync/status?provider= — current/last job for the UI poller. */
export const GET: RequestHandler = async ({ locals, url }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  const provider = url.searchParams.get('provider') ?? 'susii';
  const job = (await getActiveJob(ctx, provider)) ?? (await getLatestJob(ctx, provider));
  return json({
    active: job ? job.status === 'queued' || job.status === 'running' : false,
    status: job?.status ?? null,
    total: job?.total ?? null,
    processed: job?.processed ?? 0,
    error: job?.error ?? null,
    startedAt: job?.startedAt ?? null,
    finishedAt: job?.finishedAt ?? null,
  });
};
