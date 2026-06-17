import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { getCoreCtx } from '$server/auth/core-ctx';
import { isModuleEnabled } from '$server/services/modules.service';
import { enqueueJob } from '$server/services/finance-sync-jobs.service';
import { advanceJob } from '$server/services/finance-sync.service';

/** POST /api/finances/sync { provider } — enqueue a background sync and kick it. */
export const POST: RequestHandler = async ({ locals, request }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  if (!(await isModuleEnabled(ctx, 'finances'))) throw error(403, 'finances module disabled');
  const body = await request.json().catch(() => ({}));
  const provider = typeof body.provider === 'string' ? body.provider : 'susii';
  const job = await enqueueJob(ctx, provider);
  // Detached: runs to completion on a persistent runtime (localhost / adapter-node);
  // on Vercel serverless it may be frozen after the response — the cron tick resumes it.
  void advanceJob(ctx, job.id, { budgetMs: Number.POSITIVE_INFINITY })
    .catch((e) => console.error('[finance-sync] advanceJob failed', e));
  return json({ jobId: job.id, status: job.status });
};
