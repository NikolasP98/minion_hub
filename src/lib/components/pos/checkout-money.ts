/**
 * Pure money rules shared by the /pos/sell checkout steps.
 *
 * Everything here works in integer CENTS: the cart total, the tenders and the
 * ticket the server validates are all cent-exact, and a float sum of three
 * soles-and-centimos rows drifts.
 */

/** One row of a plan's `dueSchedule` — the wire shape `POST /api/pos/plans` takes. */
export interface PlanInstalment {
  dueOn: string;
  amount: number;
}

/**
 * Split a plan total into `count` monthly instalments, the first due on `from`.
 *
 * Cent-exact by construction: the total becomes integer cents ONCE and the
 * remainder is handed out a cent at a time to the earliest instalments, so
 * Σ amounts === round2(total) for every (total, count). Dividing in floats and
 * rounding each row drifts by a centimo, and then the last instalment never
 * settles the plan.
 *
 * Rows that would be zero (total smaller than the instalment count) are dropped
 * — the server rejects `amount <= 0`, so a 3-way split of 0.01 is ONE instalment.
 *
 * Due dates walk month by month from `from`, clamping the day to the target
 * month's length (Jan 31 → Feb 28/29). `dueOn` is a plain local YYYY-MM-DD
 * business date, never an instant.
 */
export function planDueSchedule(
  total: number,
  count: number,
  from: Date = new Date(),
): PlanInstalment[] {
  const n = Math.max(1, Math.floor(count));
  const totalCents = Math.round(total * 100);
  if (totalCents <= 0) return [];
  const base = Math.floor(totalCents / n);
  const extra = totalCents - base * n; // 0..n-1 cents left over
  const pad = (v: number) => String(v).padStart(2, '0');
  const year = from.getFullYear();
  const month = from.getMonth();
  const day = from.getDate();
  const out: PlanInstalment[] = [];
  for (let i = 0; i < n; i++) {
    const cents = base + (i < extra ? 1 : 0);
    if (cents === 0) continue; // the server rejects a zero instalment
    const y = year + Math.floor((month + i) / 12);
    const mo = (month + i) % 12;
    const lastDay = new Date(y, mo + 1, 0).getDate(); // day 0 of the next month
    out.push({ dueOn: `${y}-${pad(mo + 1)}-${pad(Math.min(day, lastDay))}`, amount: cents / 100 });
  }
  return out;
}

/**
 * What "Pay instalment" prefills into the cart line's price.
 *
 * The plan's advisory `due_schedule` says what is actually due NEXT — charging
 * the whole outstanding `remaining` silently over-collects the other unpaid
 * instalments in one go. Falls back to `remaining` only when there is no
 * schedule to read a next-due amount from (or it's fully paid off already).
 */
export function instalmentPrefillAmount(p: {
  remaining: number;
  nextDue: { amount: number } | null;
}): number {
  return p.nextDue?.amount ?? p.remaining;
}

/** The tender shape these rules need — structurally satisfied by `PaymentRow`
 *  (PaymentPanel.svelte) without dragging a component import into a pure file. */
export interface TenderLike {
  amount: number;
  tendered?: number | null;
  takesTendered: boolean;
}

/** Σ of the tender amounts, in cents. */
export function tenderedCents(rows: readonly TenderLike[]): number {
  return rows.reduce((sum, row) => sum + Math.round(row.amount * 100), 0);
}

/**
 * Cap a discount to the total it applies against (a cart line's qty×price,
 * or the order subtotal) — pos.service.ts's submitTicket rejects a bigger
 * one with `invalid_discount` (409); capping here keeps that 400
 * unreachable from the form instead of surfacing it after the fact.
 * Cent-exact like the rest of this file, and never negative.
 */
export function capDiscount(discount: number, total: number): number {
  if (!Number.isFinite(discount) || discount <= 0) return 0;
  const totalCents = Math.max(0, Math.round(total * 100));
  return Math.min(Math.round(discount * 100), totalCents) / 100;
}

/**
 * Re-fit the tenders to a cart total that CHANGED after they were entered.
 *
 * The pay step lives at `?step=pay` and the cashier can go Back, edit the cart
 * and return — with the tenders still in page state. When the total drops below
 * Σ tenders the ticket can no longer be settled, and leaving the cashier to
 * delete rows by hand was the open end (§29.1).
 *
 * Rule, deterministic and LAST-ENTERED FIRST: take the excess off the newest
 * row, drop it when it reaches zero, and keep walking backwards. The first rows
 * a cashier entered are the ones they are most sure about — the card they
 * already swiped — so the last one absorbs the change.
 *
 * `tendered` (the cash physically handed over) is only clamped when the row owed
 * NO change, i.e. it was the prefilled `tendered === amount`; a row where the
 * customer really handed over more keeps its note and simply owes more change.
 *
 * When the total RISES, or nothing is over-tendered, the rows are returned
 * unchanged (same array reference) — the shortfall is the step's "Remaining".
 */
export function fitTendersToTotal<T extends TenderLike>(
  rows: readonly T[],
  totalCents: number,
): readonly T[] {
  const floor = Math.max(0, Math.round(totalCents));
  let excess = tenderedCents(rows) - floor;
  if (excess <= 0) return rows;

  const kept: T[] = [];
  // Walk from the last-entered row backwards, spending the excess as we go.
  for (let i = rows.length - 1; i >= 0; i--) {
    const row = rows[i];
    const cents = Math.round(row.amount * 100);
    if (excess <= 0) {
      kept.unshift(row);
      continue;
    }
    if (excess >= cents) {
      excess -= cents; // row fully absorbed → dropped
      continue;
    }
    const nextCents = cents - excess;
    excess = 0;
    const tenderedC = row.tendered == null ? null : Math.round(row.tendered * 100);
    kept.unshift({
      ...row,
      amount: nextCents / 100,
      tendered:
        tenderedC == null || tenderedC > cents
          ? row.tendered // real cash in hand: keep it, the change owed simply grows
          : Math.min(tenderedC, nextCents) / 100, // prefilled/short: follow down, never up
    });
  }
  return kept;
}
