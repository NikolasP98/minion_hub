import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { getCoreDb } from '$server/db/pg-client';
import {
  enqueueJob,
  getJobById,
  listEnabledSources,
} from '$server/services/finance-sync-jobs.service';
import { advanceJob } from '$server/services/finance-sync.service';
import { reconcileParties } from '$server/services/party.service';
import { gatewayCall } from '$lib/server/gateway-rpc';
import { hubBaseUrl } from '$server/config/urls';

const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const MONITOR_WEBHOOK_TIMEOUT_MS = 5_000;

/**
 * Shout when the daily money sync fails. `advanceJob` deliberately swallows its
 * error (finance-sync.service.ts — catch → finishJob('failed')), so a broken
 * provider only ever lands in a `fin_sync_jobs` row nobody reads: in Aug 2026
 * SUSII rejected our login for 14 consecutive days and the finances screens
 * served stale money data the whole time, unnoticed. Reads the job back rather
 * than relying on a throw, so it stays correct if that swallow ever changes.
 *
 * Delivery reuses the same `channels.send` primitive notif.service uses, but
 * deliberately NOT the notif_rules engine: that path only fires if a rule row
 * exists AND the org has rules enabled AND /api/notifications/tick is actually
 * scheduled. `notif_rules` is empty in prod (checked 2026-08-12) and that tick
 * is netcup-wired rather than a vercel.json cron, so it has more ways to be
 * silently off than the failure it would report. This route is itself a
 * vercel.json cron and ran every day right through the outage.
 *
 * ponytail: no dedup — a broken money pipeline earns one message per day until
 * it is fixed. Add state only if a real incident proves that is noise.
 */
async function alertSyncFailure(orgId: string, provider: string, reason: string): Promise<void> {
  const to = env.FINANCE_ALERT_TO;
  const channel = env.FINANCE_ALERT_CHANNEL;
  if (!to || !channel) {
    console.error('[finance-sync] daily FAILED and no alert configured', {
      orgId,
      provider,
      reason,
    });
  } else {
    try {
      await gatewayCall('channels.send', {
        channel,
        to,
        text: `⚠️ Finance sync failed — org ${orgId}, provider ${provider}\n${reason}\n\nFinance data is now stale. Check /finances/settings.`,
      });
    } catch (e) {
      console.error('[finance-sync] daily alert delivery failed', orgId, e);
    }
  }
  await postFactoryMonitor(orgId, provider, reason);
}

/**
 * Mirror the same failure to the factory's `/hooks/monitor` intake so a dead
 * money sync files a maintenance-lane proposal, not just a channel message
 * nobody's watching. Independent of the channels.send path above — both fire
 * on every failure when configured. Inert (no-op) unless both
 * FINANCE_ALERT_WEBHOOK_URL and FINANCE_ALERT_WEBHOOK_TOKEN are set, so
 * current behavior is unchanged for any deployment that hasn't opted in.
 *
 * Alert delivery is best-effort and must never hold up the cron: bounded with
 * AbortSignal.timeout so an unresponsive monitor endpoint can't stall this
 * serial per-org loop until Vercel kills the function.
 */
async function postFactoryMonitor(orgId: string, provider: string, reason: string): Promise<void> {
  const url = env.FINANCE_ALERT_WEBHOOK_URL;
  const token = env.FINANCE_ALERT_WEBHOOK_TOKEN;
  if (!url || !token) return;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({
        source: 'finance-sync',
        title: `Finance sync failed — org ${orgId}, provider ${provider}`,
        fingerprint: `finance-sync:${orgId}:${provider}`,
        url: `${hubBaseUrl()}/finances/settings`,
        detail: reason,
      }),
      signal: AbortSignal.timeout(MONITOR_WEBHOOK_TIMEOUT_MS),
    });
    if (!res.ok) {
      console.error('[finance-sync] factory monitor webhook rejected', orgId, provider, res.status);
    }
  } catch (e) {
    console.error('[finance-sync] factory monitor webhook failed', orgId, provider, e);
  }
}

/**
 * GET /api/finances/sync/daily — external-scheduler entrypoint (run once/day, 3am).
 * Enqueues + advances a bounded 1-WEEK-window sync for every enabled source, across
 * all orgs. Never does a full history sweep — that stays a manual action on
 * /finances/settings. Any run that doesn't finish in-budget is picked up by the
 * per-minute `/tick` (the persisted cursor already encodes the window). Authenticates
 * via `Authorization: Bearer $CRON_SECRET`, same as `/tick`.
 */
export const GET: RequestHandler = async ({ request }) => {
  const secret = env.CRON_SECRET;
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) throw error(401);

  // Every enabled provider — post-cutover that is 'sunat-sire' (susii is
  // disabled and skipped by the enabled filter).
  const sources = await listEnabledSources();
  let started = 0;
  let failed = 0;
  for (const s of sources) {
    const ctx = { db: getCoreDb(), tenantId: s.orgId };
    try {
      const job = await enqueueJob(ctx, s.provider);
      await advanceJob(ctx, job.id, { budgetMs: 50_000, recentWindowMs: ONE_WEEK_MS });
      const finished = await getJobById(ctx, job.id);
      if (finished?.status === 'failed') {
        failed++;
        await alertSyncFailure(s.orgId, s.provider, finished.error ?? 'unknown error');
        continue; // don't count a failed sync as started, and skip reconcile
      }
      // Freshly-synced payers need their party + CRM contact minted, or they
      // sit in finances but in nobody's CRM. `syncSource` does this for manual
      // runs; this cron path calls advanceJob directly, so without it every
      // customer who first buys overnight drifts out of the CRM until someone
      // syncs by hand. Idempotent + guarded so a reconcile failure can't fail
      // the sync that already succeeded.
      try {
        await reconcileParties(ctx);
      } catch (e) {
        console.error('[finance-sync] daily reconcileParties failed', s.orgId, e);
      }
      started++;
    } catch (e) {
      console.error('[finance-sync] daily advanceJob failed', s.orgId, s.provider, e);
      failed++;
      await alertSyncFailure(s.orgId, s.provider, e instanceof Error ? e.message : String(e));
    }
  }
  return json({ started, failed });
};
