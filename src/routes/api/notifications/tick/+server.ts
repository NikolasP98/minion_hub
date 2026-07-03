import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { getCoreDb } from '$server/db/pg-client';
import { listEnabledNotifOrgs, processOrgNotifications } from '$server/services/notif.service';
// Importing the service registers its stk_reorder notif candidate source (side effect).
import '$server/services/stock.service';

/**
 * GET /api/notifications/tick — cron entrypoint for the generic notification
 * engine. Mirrors the reminders tick: Bearer $CRON_SECRET, fan out over orgs
 * with enabled rules, process due ones in a bounded chunk.
 * Wire on netcup: add a per-minute crontab line hitting this URL with the secret
 * (same as the reminders tick).
 */
export const GET: RequestHandler = async ({ request }) => {
  const secret = env.CRON_SECRET;
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) throw error(401);

  const orgIds = await listEnabledNotifOrgs();
  const now = new Date();
  let sent = 0;
  let failed = 0;
  let skipped = 0;
  for (const orgId of orgIds) {
    try {
      const r = await processOrgNotifications({ db: getCoreDb(), tenantId: orgId }, now);
      sent += r.sent;
      failed += r.failed;
      skipped += r.skipped;
    } catch (e) {
      console.error('[notifications] tick failed for org', orgId, e);
    }
  }
  return json({ orgs: orgIds.length, sent, failed, skipped });
};
