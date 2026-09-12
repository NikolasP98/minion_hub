import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { sql } from 'drizzle-orm';
import { getCoreDb } from '$server/db/pg-client';
import { sweepAbandonedUploads } from '$server/services/attachments.service';

/** Rows reaped per DB round-trip; the drain loop clears the whole backlog. */
const BATCH = 200;
/** Wall-clock ceiling for one tick. Under the crontab's `curl -m 50`. */
const BUDGET_MS = 40_000;
/** Mirrors `sweepAbandonedUploads`' default — must match the fanout selector
 *  below or an org whose only stale rows are just under this age would be
 *  selected for nothing. */
const OLDER_THAN_HOURS = 24;

/**
 * GET /api/attachments/sweep/tick — cron entrypoint that reaps `files` rows
 * left behind by an upload whose `finalizeUpload` never ran (browser closed
 * mid-PUT). Mirrors the other ticks: Bearer $CRON_SECRET, fan out over orgs
 * that have any abandoned-looking `attachment` row, drain each org fully
 * (bounded by the wall-clock budget) rather than trickling one batch per org
 * per run.
 *
 * No abandoned rows ⇒ the fanout selects no orgs ⇒ the run is a no-op.
 * Wire on netcup: add an hourly crontab line hitting this URL.
 */
export const GET: RequestHandler = async ({ request }) => {
  const secret = env.CRON_SECRET;
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) throw error(401);

  // Interval literal MUST mirror OLDER_THAN_HOURS above — it's a fixed constant
  // (not user input), so a hardcoded literal keeps the SQL simple and safe.
  const orgs = (await getCoreDb().execute(sql`
    select distinct tenant_id as org_id from files
    where category = 'attachment' and created_at < now() - interval '24 hours'
  `)) as unknown as { org_id: string }[];

  const deadline = Date.now() + BUDGET_MS;
  const totals = { orgs: orgs.length, scanned: 0, deleted: 0, storageObjectsDeleted: 0, error: 0 };
  let drained = true;
  for (const { org_id } of orgs) {
    const ctx = { db: getCoreDb(), tenantId: org_id };
    try {
      // Keep claiming batches until this org has nothing left to reap
      // (r.scanned < BATCH) or the budget runs out.
      for (;;) {
        if (Date.now() >= deadline) {
          drained = false;
          break;
        }
        const r = await sweepAbandonedUploads(ctx, {
          olderThanHours: OLDER_THAN_HOURS,
          limit: BATCH,
        });
        totals.scanned += r.scanned;
        totals.deleted += r.deleted;
        totals.storageObjectsDeleted += r.storageObjectsDeleted;
        if (r.scanned < BATCH) break; // short batch ⇒ org drained
      }
    } catch (e) {
      console.error('[attachments-sweep] tick failed for org', org_id, e);
      totals.error++;
    }
    if (!drained) break;
  }

  return json({ ok: true, drained, ...totals });
};
