import type { RequestHandler } from '@sveltejs/kit';
import { json } from '@sveltejs/kit';
import { requireCoreCtx } from '$server/auth/core-ctx';
import { requireOrgCapability } from '$server/services/rbac.service';
import { enqueueJob, getJobById } from '$server/services/meta/meta-sync-jobs.service';
import { defaultSinceDate, runJob } from '$server/services/meta/meta-sync.service';

const SYNC_KINDS = ['posts', 'ads', 'messages'] as const;

/**
 * POST /api/meta/sync/run — "Sync now" button on /ads/settings (spec §7).
 * Enqueues (idempotent — a kind already mid-run is a no-op) all three sync
 * kinds for the acting org and runs one bounded slice of each inline so the
 * user sees immediate progress; the tick resumes anything a slice didn't finish.
 */
export const POST: RequestHandler = async ({ locals }) => {
  await requireOrgCapability(locals, 'ads', 'manage');
  const ctx = await requireCoreCtx(locals);
  const since = defaultSinceDate();

  const results = [];
  for (const kind of SYNC_KINDS) {
    const job = await enqueueJob(ctx, kind, { since });
    try {
      await runJob(ctx, job.id);
    } catch (e) {
      console.error('[meta-sync] run failed', kind, e);
    }
    const final = await getJobById(ctx, job.id);
    results.push({
      kind,
      jobId: job.id,
      status: final?.status ?? job.status,
      error: final?.error ?? null,
      counts: (final?.counts as Record<string, number>) ?? {},
    });
  }
  return json({ results });
};
