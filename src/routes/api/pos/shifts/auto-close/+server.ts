import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { getCoreDb } from '$server/db/pg-client';
import { autoCloseOrgShifts, listAutoShiftOrgs } from '$server/services/pos-auto-close.service';

/**
 * GET /api/pos/shifts/auto-close — spec 148 "Caja automática". Vercel cron, HOURLY
 * (`vercel.json`), with Bearer $CRON_SECRET, like every tick: fan out over automatic
 * orgs and close their shifts opened before THEIR local midnight. Hourly, so every
 * timezone closes within the hour after its midnight and a failed close (lock timeout,
 * SUNAT slowness) is retried next hour. One org's failure never stops the others;
 * any failure answers 500 so it shows in the cron log.
 */
export const GET: RequestHandler = async ({ request }) => {
  const secret = env.CRON_SECRET;
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) throw error(401);

  const orgIds = await listAutoShiftOrgs();
  const now = new Date();
  let closed = 0;
  let failed = 0;
  for (const orgId of orgIds) {
    try {
      const r = await autoCloseOrgShifts({ db: getCoreDb(), tenantId: orgId }, now);
      closed += r.closed;
      failed += r.failed;
    } catch (e) {
      failed++;
      console.error('[pos] auto-close failed for org', orgId, e);
    }
  }
  return json(
    { ok: failed === 0, orgs: orgIds.length, closed, failed },
    { status: failed ? 500 : 200 },
  );
};
