import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { z } from 'zod';
import { getCoreCtx } from '$server/auth/core-ctx';
import { getActiveJob, getLatestJob, getJobById } from '$server/services/finance-sync-jobs.service';

/** GET /api/finances/sync/status?provider= — current/last job for the UI poller. */
export const GET: RequestHandler = async ({ locals, url }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  const provider = url.searchParams.get('provider') ?? 'susii';
  const jobId = url.searchParams.get('jobId');
  if (jobId !== null && !z.string().uuid().safeParse(jobId).success)
    throw error(400, 'Invalid job ID');
  const job = jobId
    ? await getJobById(ctx, jobId)
    : ((await getActiveJob(ctx, provider)) ?? (await getLatestJob(ctx, provider)));
  return json({
    jobId: job?.id ?? null,
    active: job ? job.status === 'queued' || job.status === 'running' : false,
    status: job?.status ?? null,
    total: job?.total ?? null,
    processed: job?.processed ?? 0,
    error: job?.error ?? null,
    startedAt: job?.startedAt ?? null,
    finishedAt: job?.finishedAt ?? null,
  });
};
