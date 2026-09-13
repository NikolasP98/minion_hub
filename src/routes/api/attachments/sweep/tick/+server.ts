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
 * Default mode also reaps files whose last link was hidden (trashed) more than
 * TRASH_RETENTION_DAYS ago; a file with any recent trash row is left alone.
 * No abandoned rows ⇒ the fanout selects no orgs ⇒ the run is a no-op.
 * Two schedules: `?mode=deletion-claims` hourly (replays already-authorized
 * deletions, never claims new files) and the default mode daily (abandoned
 * uploads + the 30-day trash purge; enabled 2026-09-13 after a read-only
 * preflight found nothing reapable).
 * `drained` describes work eligible now, excluding live upload URLs/hourly tombstones.
 */
export const GET: RequestHandler = async ({ request, url }) => {
  const secret = env.CRON_SECRET;
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) throw error(401);

  const mode = url.searchParams.get('mode') ?? 'abandoned';
  if (!['abandoned', 'deletion-claims'].includes(mode))
    throw error(400, 'Invalid attachment sweep mode');
  const pendingOnly = mode === 'deletion-claims';

  // Interval literals MUST mirror OLDER_THAN_HOURS above and TRASH_RETENTION_DAYS
  // (attachment-lifecycle.ts) — fixed constants, not user input, so hardcoded
  // literals keep the SQL simple and safe.
  const orgs = (await getCoreDb().execute(
    pendingOnly
      ? sql`SELECT DISTINCT org_id::uuid AS org_id FROM attachment_file_state WHERE state='deleting'`
      : sql`
    select distinct tenant_id as org_id from files
    where created_at < now() - interval '24 hours'
      and (category = 'attachment' or b2_file_key like tenant_id::text || '/attachments/%'
        or exists (select 1 from attachment_file_state s where s.file_id=files.id))
      and not exists (select 1 from attachment_links l where l.file_id=files.id)
      and not exists (select 1 from attachment_trash t where t.file_id=files.id
        and t.hidden_at > now() - interval '30 days')
    union
    select org_id::uuid from attachment_file_state where state='deleting'
  `,
  )) as unknown as { org_id: string }[];

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
          pendingOnly,
        });
        totals.scanned += r.scanned;
        totals.deleted += r.deleted;
        totals.storageObjectsDeleted += r.storageObjectsDeleted;
        if (r.failed > 0) {
          totals.error += r.failed;
          drained = false;
          break;
        }
        if (r.scanned < BATCH) break; // short batch ⇒ org drained
      }
    } catch (e) {
      console.error('[attachments-sweep] tick failed for org', org_id);
      drained = false;
      totals.error++;
    }
    if (Date.now() >= deadline) break;
  }

  return json({ ok: true, mode, drained, ...totals });
};
