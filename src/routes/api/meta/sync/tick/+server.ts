import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { getCoreDb } from '$server/db/pg-client';
import {
  enqueueJob,
  findDueJobs,
  getLatestSucceededJob,
  pruneTerminalTailJobs,
} from '$server/services/meta/meta-sync-jobs.service';
import {
  defaultSinceDate,
  listConnectedOrgIds,
  runJob,
} from '$server/services/meta/meta-sync.service';

const SYNC_KINDS = ['posts', 'ads', 'messages', 'messages_tail'] as const;
const STALE_ENQUEUE_MS = 6 * 60 * 60_000; // spec §6: re-enqueue a kind once its last success is >6h old
/**
 * The tail lane is topped up on EVERY tick, so message freshness equals the
 * scheduler period for this route (netcup crontab in production). Tightening
 * freshness is a scheduling change, not a code change; no staleness constant
 * here can beat the scheduler period.
 */
const MESSAGE_TAIL_STALE_MS = 0;
/** Up to one cheap tail slice per connected org, capped at 24 orgs per tick.
 * Backlog slices are orders of magnitude more expensive (up to 150 posts / 100
 * conversations / 90 ad rows each, run sequentially in this one request), so
 * that lane stays at a small fixed cap no matter how many orgs connect — it is
 * catch-up work, not latency-sensitive. */
const TAIL_CLAIM_MIN = 3;
const TAIL_CLAIM_MAX = 24;
const BACKLOG_CLAIM_LIMIT = 3;

/**
 * GET/POST /api/meta/sync/tick — cron entrypoint (Vercel Cron only ever sends
 * GET; POST is accepted too so a manual curl/netcup crontab line matches the
 * other tick routes' Bearer $CRON_SECRET convention). Wire on netcup with the
 * same crontab shape as the other tick lines (memory: hub-netcup-cron-ticks).
 * This path is in the hooks.server.ts unauth allowlist (WP3) — required or it
 * 401s before this handler runs.
 *
 * Two phases, each per-job/per-org isolated so one failure never 500s the tick:
 * 1. enqueue-if-stale — for every org with a live Meta connection, top up any
 *    sync kind whose last SUCCESS is stale (or has never run).
 * 2. claim + advance a bounded number of due jobs (queued, or running past the
 *    staleness window) across all orgs, one bounded slice each.
 */
const handle: RequestHandler = async ({ request }) => {
  const secret = env.CRON_SECRET;
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) throw error(401);

  const since = defaultSinceDate();
  const orgIds = await listConnectedOrgIds();
  let enqueued = 0;
  for (const orgId of orgIds) {
    const ctx = { db: getCoreDb(), tenantId: orgId };
    for (const kind of SYNC_KINDS) {
      try {
        const latest = await getLatestSucceededJob(ctx, kind);
        const ageMs = latest?.finishedAt
          ? Date.now() - new Date(latest.finishedAt).getTime()
          : Number.POSITIVE_INFINITY;
        const staleAfter = kind === 'messages_tail' ? MESSAGE_TAIL_STALE_MS : STALE_ENQUEUE_MS;
        if (ageMs > staleAfter) {
          await enqueueJob(ctx, kind, { since });
          enqueued++;
        }
      } catch (e) {
        console.error('[meta-sync] tick enqueue-if-stale failed', orgId, kind, e);
      }
    }
  }

  const due = await findDueJobs(
    Math.min(TAIL_CLAIM_MAX, Math.max(TAIL_CLAIM_MIN, orgIds.length)),
    BACKLOG_CLAIM_LIMIT,
  );
  const results: Array<{
    jobId: string;
    orgId: string;
    kind: string;
    ok: boolean;
    error?: string;
  }> = [];
  for (const j of due) {
    const ctx = { db: getCoreDb(), tenantId: j.orgId };
    try {
      await runJob(ctx, j.jobId);
      results.push({ jobId: j.jobId, orgId: j.orgId, kind: j.kind, ok: true });
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'tick job failed';
      console.error('[meta-sync] tick runJob failed', j.jobId, e);
      results.push({ jobId: j.jobId, orgId: j.orgId, kind: j.kind, ok: false, error: msg });
    }
  }
  let pruned = 0;
  try {
    pruned = await pruneTerminalTailJobs();
  } catch (e) {
    console.error('[meta-sync] tail job retention failed', e);
  }
  return json({ enqueued, claimed: results.length, pruned, results });
};

export const GET = handle;
export const POST = handle;
