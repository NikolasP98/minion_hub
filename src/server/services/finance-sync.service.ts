import type { CoreCtx } from '$server/auth/core-ctx';
import { getConnector } from '$server/finance/connector';
import '$server/finance/connectors/susii-connector'; // self-registers the 'susii' connector
import { getSource, upsertInvoicesBatch, loadProductMap, bustFinanceCache, setSourceSync } from './finance.service';
import { decryptCreds } from './finance-secrets';
import { overlapSince, nowIso } from './finance-sync.helpers';
import { claimJob, getJobById, heartbeat, isCancelRequested, finishJob, enqueueJob } from './finance-sync-jobs.service';
import { reconcileParties } from './party.service';

/**
 * Advance one sync job by pulling pages until the source is drained, the time
 * budget is spent, or cancel is requested. Resumable: persists the page cursor
 * after every page, so a later call (manual re-trigger or cron tick) continues
 * from where this one stopped. budgetMs = Infinity runs to completion.
 */
export async function advanceJob(ctx: CoreCtx, jobId: string, opts: { budgetMs: number }): Promise<void> {
  if (!(await claimJob(ctx, jobId))) return; // already actively running elsewhere, or terminal
  const job = await getJobById(ctx, jobId);
  if (!job) return;
  const provider = job.provider;

  const source = await getSource(ctx, provider);
  if (!source || !source.enabled) {
    await finishJob(ctx, jobId, 'failed', { error: 'source disabled or missing' });
    return;
  }
  const connector = getConnector(provider);
  if (!connector) {
    await finishJob(ctx, jobId, 'failed', { error: `no connector registered for provider ${provider}` });
    return;
  }
  const refs = (source.secretRefs ?? {}) as Record<string, unknown>;
  if (!refs.ciphertext || !refs.iv) {
    await setSourceSync(ctx, provider, { watermark: source.watermark ?? '', status: 'failed' });
    await finishJob(ctx, jobId, 'failed', { error: 'no credentials configured' });
    return;
  }
  const { username, password } = decryptCreds(String(refs.ciphertext), String(refs.iv));
  const secrets: Record<string, string> = { username, password };
  const config = (source.config ?? {}) as Record<string, unknown>;
  const since = overlapSince(source.watermark);
  // Watermark target = when THIS backfill began (advance-only; overlapSince covers the edge).
  const watermarkTarget = job.startedAt ? new Date(job.startedAt).toISOString() : nowIso();

  let processed = job.processed;
  let total = job.total;
  let cursor: string | null = job.pageCursor ?? null;
  const deadline = Date.now() + opts.budgetMs;

  // Seed the % baseline once.
  if (total == null && connector.count) {
    total = await connector.count({ config, secrets, since }).catch(() => null);
    if (total != null) await heartbeat(ctx, jobId, { processed, total, pageCursor: cursor });
  }

  const productMap = await loadProductMap(ctx);

  try {
    for await (const page of connector.pullPages({ config, secrets, since, cursor })) {
      if (await isCancelRequested(ctx, jobId)) { await finishJob(ctx, jobId, 'cancelled'); return; }
      try {
        await upsertInvoicesBatch(ctx, page.invoices, productMap); // one tx for the whole page (atomic)
        processed += page.invoices.length;
      } catch (e) {
        throw e instanceof Error ? e : new Error('batch upsert failed'); // page tx rolled back; cursor preserved
      }
      cursor = page.cursor;
      await heartbeat(ctx, jobId, { processed, total, pageCursor: cursor });
      if (cursor == null) {
        await setSourceSync(ctx, provider, { watermark: watermarkTarget, status: 'success' });
        await finishJob(ctx, jobId, 'succeeded');
        await bustFinanceCache(ctx);
        return;
      }
      if (Date.now() > deadline) return;
    }
    await setSourceSync(ctx, provider, { watermark: watermarkTarget, status: 'success' });
    await finishJob(ctx, jobId, 'succeeded');
    await bustFinanceCache(ctx);
  } catch (e) {
    await setSourceSync(ctx, provider, { watermark: source.watermark ?? '', status: 'failed' });
    await finishJob(ctx, jobId, 'failed', { error: e instanceof Error ? e.message : 'sync failed' });
  }
}

/** Convenience: enqueue + run to completion in-process, returning a summary. */
export async function syncSource(ctx: CoreCtx, provider: string) {
  const job = await enqueueJob(ctx, provider);
  await advanceJob(ctx, job.id, { budgetMs: Number.POSITIVE_INFINITY });
  const final = await getJobById(ctx, job.id);
  const status = final?.status === 'succeeded' ? 'success' : (final?.status ?? 'failed');
  // Link freshly-synced fin_clients to the shared party spine (idempotent).
  // ponytail: cron-resumed advanceJob() doesn't reconcile — the next harvest or
  // manual sync catches up; acceptable for a soft analytics link.
  if (status === 'success') await reconcileParties(ctx);
  return { provider, count: final?.processed ?? 0, status };
}
