/**
 * Pure client-account math: credit balance, package-grant status, per-session
 * value allocation. No DB — the orchestration (pos-accounts.service.ts,
 * pos-packages.service.ts) reads rows around these inside one `withOrgCore`
 * transaction. Same split as stock.service.ts / stock.logic.ts, so the rules
 * that actually decide whether a client can book are unit-testable without a
 * mocked db.
 *
 * Spec: specs/2026-09-13-pos-scheduling-packages-payment-plans-spec.md §2.
 */

import { zonedDateKey } from '$server/scheduling/tz';
import { divideDecimalToMinor } from '$lib/money/decimal';
import {
  moneyNumber,
  storedDecimalNumber,
  storedMinorNumber,
  storedMoneyMinor,
  withMoneyError,
} from './pos/money';

/** Money rounding, matching pos.service.ts. */
export const round2 = (n: number | string) => moneyNumber(n);

/** Postgres numeric may be text or Number, but invalid stored values are errors. */
export function toAmount(v: string | number | null | undefined): number {
  return storedDecimalNumber(v);
}

/**
 * Stored-value balance = the plain sum of every ledger row's SIGNED amount.
 * Positive rows add credit, negative rows consume it, and a reversal is an
 * opposing row rather than an edit — so the sum over ALL rows for a client is
 * always the current balance, with no state to reconcile.
 */
export function ledgerBalance(rows: { amount: string | number | null }[]): number {
  return storedMinorNumber(rows.reduce((sum, row) => sum + storedMoneyMinor(row.amount, true), 0n));
}

export const GRANT_STATUSES = ['active', 'exhausted', 'expired', 'cancelled'] as const;
export type GrantStatus = (typeof GRANT_STATUSES)[number];

/**
 * Sessions left on a grant. `used` is always a COUNT of non-reversed
 * redemption rows — never a stored counter — so this cannot drift.
 *
 * Clamped at 0: a negative remainder would only come from a bug, and rendering
 * "-1 sessions left" in the drawer helps nobody. `grantStatus` still reads
 * `used >= total` so an over-redeemed grant correctly refuses new bookings.
 */
export function sessionsRemaining(sessionsTotal: number, used: number): number {
  return Math.max(0, sessionsTotal - used);
}

/**
 * A grant expires at the END of `expiresAt` — a package whose validity runs out
 * TODAY is still redeemable today. Hence strict `<`, not `<=`.
 *
 * `today` is a 'YYYY-MM-DD' key; ISO date strings compare correctly
 * lexicographically, so no Date parsing (and no UTC-vs-local off-by-one) is
 * involved. Get the key from `grantToday()`, which resolves it in the org's
 * timezone — a Lima clinic must not see a package die 5 hours early because
 * UTC already rolled over.
 */
export function isExpired(expiresAt: string | null | undefined, today: string): boolean {
  return expiresAt != null && expiresAt < today;
}

/** Today's 'YYYY-MM-DD' in the org's timezone. */
export function grantToday(timeZone: string, now: Date = new Date()): string {
  return zonedDateKey(now, timeZone);
}

export interface GrantStatusInput {
  sessionsTotal: number;
  /** Non-reversed redemption rows. */
  used: number;
  expiresAt?: string | null;
  /** The STORED status; only 'cancelled' is authoritative here. */
  status?: string | null;
}

/**
 * Derived grant status, in precedence order:
 *
 *   cancelled — an explicit staff action, it outranks everything
 *   exhausted — every session consumed; more informative than "expired" for a
 *               package the client actually used up
 *   expired   — validity window closed with sessions left on the table
 *   active    — redeemable right now
 *
 * Only 'active'/'cancelled' are ever STORED (spec §2.3: a nightly tick may
 * materialise the rest later); exhaustion and expiry are computed on read so
 * they can never be stale.
 */
export function grantStatus(input: GrantStatusInput, today: string): GrantStatus {
  if (input.status === 'cancelled') return 'cancelled';
  if (input.used >= input.sessionsTotal) return 'exhausted';
  if (isExpired(input.expiresAt, today)) return 'expired';
  return 'active';
}

/** True when one more session can be drawn from this grant right now. */
export function isRedeemable(input: GrantStatusInput, today: string): boolean {
  return grantStatus(input, today) === 'active';
}

export interface PackageEdge {
  childProductId: string;
  /** Sessions of the child service contained in ONE unit of the package. */
  qty: number;
}

export interface GrantAllocation {
  childProductId: string;
  sessionsTotal: number;
  unitValue: number;
}

/**
 * Split one package ticket line into per-child grants.
 *
 * `sessionsTotal = edge.qty * line.qty` (spec §3.1) and the line's money is
 * spread evenly across every session it bought:
 *
 *     unitValue = lineTotal / (lineQty * Σ edge.qty)
 *
 * NOTE — the spec writes `unit_value = line.total / Σ(edge.qty)`, which drops
 * `line.qty`: selling 2× a 3-session package would value each of the 6 sessions
 * at 2/3 of the package price, so the grants would claim twice the revenue the
 * line actually took. The `lineQty` divisor is the only reading under which
 * `Σ(unitValue × sessionsTotal) === lineTotal`, and it is identical to the spec
 * for the qty=1 case.
 *
 * ponytail: the per-session value is a flat split, rounded to cents, so a total
 * that doesn't divide evenly leaves sub-cent dust (100 over 3 sessions →
 * 3×33.33 = 99.99). unit_value drives revenue *recognition* and the value shown
 * on a redeemed 0-priced line — no money moves on it — so weighting by child
 * list price or largest-remainder distribution can wait until a report actually
 * needs the cent back.
 */
export function allocateGrants(
  lineTotal: number,
  lineQty: number,
  edges: PackageEdge[],
): GrantAllocation[] {
  const usable = edges.filter((e) => e.qty > 0);
  const totalSessions = usable.reduce((a, e) => a + e.qty, 0) * lineQty;
  if (!usable.length || !(lineQty > 0) || totalSessions <= 0) return [];
  const unitValue = withMoneyError('invalid_amount', () =>
    storedMinorNumber(divideDecimalToMinor(lineTotal, totalSessions)),
  );
  return usable.map((e) => ({
    childProductId: e.childProductId,
    sessionsTotal: e.qty * lineQty,
    unitValue,
  }));
}

/**
 * Plan progress. Paid-to-date is the sum of the plan's ticket lines over
 * NON-VOID tickets (the caller filters), so voiding an instalment ticket
 * un-pays the plan for free.
 */
export function planProgress(
  totalAmount: string | number,
  paidLines: { total: string | number | null }[],
): { paidToDate: number; remaining: number; isPaid: boolean } {
  const total = storedMoneyMinor(totalAmount, true);
  const paid = paidLines.reduce((sum, line) => sum + storedMoneyMinor(line.total), 0n);
  return {
    paidToDate: storedMinorNumber(paid),
    remaining: storedMinorNumber(total - paid),
    isPaid: paid >= total,
  };
}

export {
  nextDueInstalment,
  readDueSchedule,
  validateDueSchedule,
  type DueInstalment,
  type ScheduleIssue,
} from './pos/payment-plan-schedule';

/**
 * `expires_at` for a package sold today with `validityDays` of validity.
 * Day-count arithmetic on the date key only — no instants, no DST, no
 * timezone: "90 days of validity" is 90 calendar days in the org's own
 * calendar, and `today` already came from it.
 */
export function expiryFrom(today: string, validityDays: number | null | undefined): string | null {
  if (validityDays == null || !Number.isFinite(validityDays) || validityDays <= 0) return null;
  const [y, m, d] = today.split('-').map(Number);
  const end = new Date(Date.UTC(y, m - 1, d + Math.floor(validityDays)));
  return end.toISOString().slice(0, 10);
}
