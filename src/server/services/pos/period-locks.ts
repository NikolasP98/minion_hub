import { and, eq, sql, type SQL } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';
import type { CoreTx } from '$server/db/with-org-core';
import { posPeriodLocks } from '$server/db/pg-pos-schema';
import { PosError } from './errors';

/**
 * Accounting period locks (spec 2026-10-15-hub-pos-shift-scoped-edits T4).
 * A period is a calendar month in the org's ACCOUNTING timezone
 * (`fin_settings.timezone`, Lima by default) — resolved inside the query so
 * every mutator reads the same month without plumbing a timezone through.
 */
const PERIOD_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

export function normalizePeriod(raw: string): string {
  const period = raw.trim();
  if (!PERIOD_RE.test(period)) throw new PosError('period must be YYYY-MM', 'invalid_period');
  return period;
}

/** `exists (…)` — true when a lock covers the month `submittedAt` falls in.
 *  `submittedAt` is a column (for set-based filters) or one instant. */
export function periodLockExists(orgId: string, submittedAt: PgColumn | Date): SQL<boolean> {
  const instant =
    submittedAt instanceof Date ? sql`${submittedAt.toISOString()}::timestamptz` : submittedAt;
  return sql<boolean>`exists (
    select 1 from pos_period_locks l
    where l.org_id = ${orgId}
      and l.period = to_char(
        (${instant} at time zone coalesce(
          (select f.timezone from fin_settings f where f.org_id = ${orgId}), 'America/Lima')),
        'YYYY-MM')
  )`;
}

export async function isTicketPeriodLocked(
  tx: CoreTx,
  orgId: string,
  submittedAt: Date,
): Promise<boolean> {
  const rows = await tx
    .select({ id: posPeriodLocks.id })
    .from(posPeriodLocks)
    .where(and(eq(posPeriodLocks.orgId, orgId), periodLockExists(orgId, submittedAt)))
    .limit(1);
  return rows.length > 0;
}
