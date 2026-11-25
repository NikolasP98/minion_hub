import { and, eq, lt } from 'drizzle-orm';
import { getCoreDb } from '$server/db/pg-client';
import { withOrgCore } from '$server/db/with-org-core';
import { posSettings, posShifts } from '$server/db/pg-pos-schema';
import type { CoreCtx } from '$server/auth/core-ctx';
import { instantDateKey, startOfZonedDate } from '$lib/time/zoned';
import { getFinSettings } from './finance.service';
import { closeShift } from './pos.service';

/** Orgs running "Caja automática" (spec 148). Cross-org read, like every cron tick. */
export async function listAutoShiftOrgs(): Promise<string[]> {
  const rows = await getCoreDb()
    .select({ orgId: posSettings.orgId })
    .from(posSettings)
    .where(eq(posSettings.shiftMode, 'auto'));
  return rows.map((r) => r.orgId);
}

/**
 * Close every shift of one automatic org that opened before today's local
 * midnight, through the normal `closeShift` (so the day's tickets go to SUNAT
 * exactly as on a manual close), with counted = expected. A shift opened after
 * midnight is today's and stays open; a re-run finds nothing left to close.
 *
 * TODO(handoff): a missed run (Vercel cron outage) leaves yesterday's shift open
 * until the next midnight — a sale does not close it first. Follow-up in spec 148
 * (minion-meta specs/148-caja-automatica) if it ever bites.
 */
export async function autoCloseOrgShifts(
  ctx: CoreCtx,
  now: Date,
): Promise<{ closed: number; failed: number }> {
  const tz = (await getFinSettings(ctx)).timezone;
  const midnight = startOfZonedDate(instantDateKey(now, tz), tz);
  if (!midnight.ok) throw new Error(`cannot resolve local midnight in ${tz}`);
  const stale = await withOrgCore(ctx, (tx) =>
    tx
      .select({ id: posShifts.id, openedBy: posShifts.openedBy })
      .from(posShifts)
      .where(
        and(
          eq(posShifts.orgId, ctx.tenantId),
          eq(posShifts.status, 'open'),
          lt(posShifts.openedAt, midnight.instant),
        ),
      ),
  );
  let closed = 0;
  let failed = 0;
  for (const shift of stale) {
    try {
      await closeShift(ctx, {
        counted: {},
        countedFromExpected: true,
        note: 'Cierre automático',
        // closed_by is a profile uuid; the job acts for the cashier who opened it.
        actor: { id: shift.openedBy, name: 'cierre-automatico' },
        shiftId: shift.id,
      });
      closed++;
    } catch (e) {
      failed++;
      console.error('[pos] auto-close failed for shift', shift.id, e);
    }
  }
  return { closed, failed };
}
