import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { getCoreDb } from '$server/db/pg-client';
import { listEnabledMembershipOrgs, processMembershipCycles } from '$server/services/membership.service';

/**
 * GET /api/memberships/tick — cron entrypoint for recurring membership billing.
 * Mirrors the reminders/notifications ticks: Bearer $CRON_SECRET, fan out over
 * orgs with active memberships, spawn due cycles (+ draft sales orders).
 * Wire on netcup: add a per-minute (or hourly) crontab line hitting this URL.
 */
export const GET: RequestHandler = async ({ request }) => {
  const secret = env.CRON_SECRET;
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) throw error(401);

  const orgIds = await listEnabledMembershipOrgs();
  const now = new Date();
  let spawned = 0;
  let skipped = 0;
  for (const orgId of orgIds) {
    try {
      const r = await processMembershipCycles({ db: getCoreDb(), tenantId: orgId }, now);
      spawned += r.spawned;
      skipped += r.skipped;
    } catch (e) {
      console.error('[memberships] tick failed for org', orgId, e);
    }
  }
  return json({ ok: true, orgs: orgIds.length, spawned, skipped });
};
