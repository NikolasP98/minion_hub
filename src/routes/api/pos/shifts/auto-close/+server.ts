import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { getCoreDb } from '$server/db/pg-client';
import { autoCloseOrgShifts, listAutoShiftOrgs } from '$server/services/pos-auto-close.service';

/**
 * GET /api/pos/shifts/auto-close — spec 148 "Caja automática". Vercel cron
 * (`vercel.json`, 00:00 America/Lima) with Bearer $CRON_SECRET, like every tick:
 * fan out over automatic orgs and close their shifts opened before local midnight.
 * One org's failure never stops the others.
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
  return json({ ok: true, orgs: orgIds.length, closed, failed });
};
