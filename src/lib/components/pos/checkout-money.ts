/**
 * Pure money rules shared by the /pos/sell checkout steps.
 *
 * Everything here works in integer CENTS: the cart total, the tenders and the
 * ticket the server validates are all cent-exact, and a float sum of three
 * soles-and-centimos rows drifts.
 */

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
