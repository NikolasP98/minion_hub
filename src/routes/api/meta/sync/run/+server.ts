import type { RequestHandler } from '@sveltejs/kit';
import { json } from '@sveltejs/kit';
import { requireCoreCtx } from '$server/auth/core-ctx';
import { requireOrgCapability } from '$server/services/rbac.service';
import { enqueueJob, getJobById } from '$server/services/meta/meta-sync-jobs.service';
import { resolveSyncSince, runJob, type SyncKind } from '$server/services/meta/meta-sync.service';

const SYNC_KINDS: SyncKind[] = ['posts', 'ads', 'messages'];

/** `?full=1` or JSON body `{ full: true }` — a plain button POST sends neither, so a body-parse failure just means "not full". */
async function isFullRequest(url: URL, request: Request): Promise<boolean> {
  if (url.searchParams.get('full') === '1') return true;
  try {
    const body = (await request.json()) as { full?: unknown } | null;
    return body?.full === true;
  } catch {
    return false;
  }
}

/**
 * POST /api/meta/sync/run — "Sync now" button on /ads/settings (spec §7).
 * Enqueues (idempotent — a kind already mid-run is a no-op) all three sync
 * kinds for the acting org and runs one bounded slice of each inline so the
 * user sees immediate progress; the tick resumes anything a slice didn't finish.
 * `full=1` requests the entire available history instead of the normal 90-day window.
 */
export const POST: RequestHandler = async ({ locals, url, request }) => {
  await requireOrgCapability(locals, 'ads', 'manage');
  const ctx = await requireCoreCtx(locals);
  const full = await isFullRequest(url, request);

  const results = [];
  for (const kind of SYNC_KINDS) {
    const job = await enqueueJob(ctx, kind, { since: resolveSyncSince(kind, full) });
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
