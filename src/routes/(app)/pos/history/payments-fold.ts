import { instantDateKey } from '$lib/time/zoned';

/**
 * Splitting one list of payment rows into the two readings the sales-history
 * table shows.
 *
 * They are NOT the same sum. Since the explicit-refund void (spec 2026-10-13
 * I4) a void writes a negative counter-row per original method into the shift
 * that HANDED THE MONEY BACK — which is rarely the shift that sold. So:
 *
 * - "how was this ticket paid" is the ticket's own rows, counter-rows excluded;
 * - "what did this shift take" is every row stamped with that shift, refunds
 *   included and negative, exactly the rule `paymentsByMethod` uses at close.
 *   A same-shift cash refund nets to zero there; a later one shows as `-X`.
 */
export interface FoldablePayment {
  ticketId: string;
  shiftId: string;
  method: string;
  amount: number;
  refund: boolean;
}

export interface FoldedPayments {
  /** Ticket id → how it was paid, in payment order. */
  byTicket: Map<string, { method: string; amount: number }[]>;
  /** Shift id → method → net amount the shift took. */
  methodTotals: Record<string, Record<string, number>>;
}

export function foldPayments(payments: readonly FoldablePayment[]): FoldedPayments {
  const byTicket = new Map<string, { method: string; amount: number }[]>();
  const methodTotals: Record<string, Record<string, number>> = {};
  for (const p of payments) {
    if (!p.refund) {
      const list = byTicket.get(p.ticketId) ?? [];
      list.push({ method: p.method, amount: p.amount });
      byTicket.set(p.ticketId, list);
    }
    const shift = (methodTotals[p.shiftId] ??= {});
    shift[p.method] = (shift[p.method] ?? 0) + p.amount;
  }
  return { byTicket, methodTotals };
}

/** A payment row stamped with when it happened — the calendar views need the
 *  org-local day, nothing else here is tz-aware. */
export interface TimedPayment extends FoldablePayment {
  at: string | Date;
}

export interface DayTotal {
  /** Net of every row (refund counter-rows included, negative) — same
   *  reading `methodTotals` gives per shift, bucketed by calendar day instead. */
  total: number;
  byMethod: Record<string, number>;
}

/** Folds every payment row into the org-local calendar day it landed on
 *  (`Intl.DateTimeFormat` in `tz`, not `toISOString()` — a day boundary a few
 *  hours off UTC must not bleed into the next day). Refund rows are included
 *  and already negative, so a same-day refund nets the day down exactly like
 *  a shift's own total does. */
export function dayTotals(payments: readonly TimedPayment[], tz: string): Record<string, DayTotal> {
  const days: Record<string, DayTotal> = {};
  for (const p of payments) {
    const key = instantDateKey(new Date(p.at), tz);
    const bucket = (days[key] ??= { total: 0, byMethod: {} });
    bucket.total += p.amount;
    bucket.byMethod[p.method] = (bucket.byMethod[p.method] ?? 0) + p.amount;
  }
  return days;
}

/** Which shift ids have at least one payment stamped on the given org-local
 *  calendar day — the month view's day-click Sheet lookup. Reuses the same
 *  tz-aware day key `dayTotals` folds by, so a Sheet and its calendar cell
 *  always agree on what counts as "that day". */
export function shiftsOnDay(
  payments: readonly TimedPayment[],
  tz: string,
  dayKey: string,
): Set<string> {
  const ids = new Set<string>();
  for (const p of payments) {
    if (instantDateKey(new Date(p.at), tz) === dayKey) ids.add(p.shiftId);
  }
  return ids;
}
