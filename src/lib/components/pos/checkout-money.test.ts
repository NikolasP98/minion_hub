import { describe, expect, it } from 'vitest';
import { changeDue, rowChange, type PaymentRow } from './PaymentPanel.svelte';
import { lineCents, lineNeedsPrice, lineKey, type CartLine } from './SellCart.svelte';
import {
  capDiscount,
  fitTendersToTotal,
  instalmentPrefillAmount,
  planDueSchedule,
  tenderedCents,
} from './checkout-money';

function tender(over: Partial<PaymentRow> = {}): PaymentRow {
  return { method: 'cash', amount: 100, tendered: 100, takesTendered: true, ...over };
}
function line(over: Partial<CartLine> = {}): CartLine {
  return {
    sellable: {
      productId: 'p1',
      code: 'P1',
      name: 'Service',
      category: null,
      unitPrice: 50,
      active: true,
      kind: 'service',
      itemId: null,
      stockQty: null,
      hasMapping: false,
    },
    qty: 1,
    unitPrice: 50,
    discount: 0,
    ...over,
  };
}

describe('checkout money', () => {
  it('keeps two appointments and an ordinary sale of the same product distinct', () => {
    const keys = [line(), line({ bookingId: 'b1' }), line({ bookingId: 'b2' })].map(lineKey);
    expect(new Set(keys).size).toBe(3);
  });
  it('owes no change when the tender exactly covers the row', () => {
    expect(rowChange(tender())).toBe(0);
  });

  it('owes the excess when a cash-like tender exceeds the amount', () => {
    expect(rowChange(tender({ amount: 87.4, tendered: 100 }))).toBe(12.6);
  });

  it('never owes change on a non-cash tender', () => {
    expect(rowChange(tender({ takesTendered: false, tendered: 500 }))).toBe(0);
    expect(rowChange(tender({ tendered: null }))).toBe(0);
  });

  it('sums change across tenders without float drift', () => {
    expect(
      changeDue([tender({ amount: 0.1, tendered: 0.3 }), tender({ amount: 0.1, tendered: 0.3 })]),
    ).toBe(0.4);
  });

  it('exempts a redeemed session from the "needs a price" block', () => {
    expect(lineNeedsPrice(line({ unitPrice: 0 }))).toBe(true);
    expect(lineNeedsPrice(line({ unitPrice: 0, redemptionId: 'r1' }))).toBe(false);
  });

  it('totals a line in integer cents, discount included', () => {
    expect(lineCents(line({ qty: 3, unitPrice: 19.99, discount: 5 }))).toBe(5497);
    expect(lineCents(line({ unitPrice: 0, redemptionId: 'r1' }))).toBe(0);
  });

  it('clamps a line to 0 rather than going negative when the discount exceeds the line total', () => {
    expect(lineCents(line({ qty: 1, unitPrice: 80, discount: 999 }))).toBe(0);
  });
});

/**
 * The instalment split is money: the plan is only settleable when the schedule
 * sums to the total to the cent, and the server rejects a zero instalment.
 */
describe('planDueSchedule', () => {
  const sumCents = (rows: { amount: number }[]) =>
    rows.reduce((s, r) => s + Math.round(r.amount * 100), 0);

  it('sums exactly to the total, however awkward the division', () => {
    for (const total of [100, 100.01, 0.07, 999.99, 1234.56]) {
      for (const n of [1, 2, 3, 6, 7, 12]) {
        expect(sumCents(planDueSchedule(total, n))).toBe(Math.round(total * 100));
      }
    }
  });

  it('spreads the leftover cents over the earliest instalments', () => {
    expect(planDueSchedule(100, 3, new Date(2026, 0, 10)).map((r) => r.amount)).toEqual([
      33.34, 33.33, 33.33,
    ]);
  });

  it('never emits a zero instalment (the server rejects amount <= 0)', () => {
    const rows = planDueSchedule(0.02, 5);
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.amount > 0)).toBe(true);
    expect(sumCents(rows)).toBe(2);
  });

  it('walks months from the first due date, clamping short months', () => {
    expect(planDueSchedule(300, 3, new Date(2026, 0, 31)).map((r) => r.dueOn)).toEqual([
      '2026-01-31',
      '2026-02-28',
      '2026-03-31',
    ]);
  });

  it('rolls over the year', () => {
    expect(planDueSchedule(200, 2, new Date(2026, 11, 5)).map((r) => r.dueOn)).toEqual([
      '2026-12-05',
      '2027-01-05',
    ]);
  });

  it('has nothing to schedule for a non-positive total', () => {
    expect(planDueSchedule(0, 3)).toEqual([]);
  });
});

/**
 * §29.1 — the cart can be edited AFTER a tender is entered (Back from
 * `?step=pay`), so Σ tenders can end up above the new total. The rows must
 * re-fit themselves, last-entered first, instead of leaving the cashier to
 * delete rows by hand.
 */
describe('fitTendersToTotal', () => {
  const rows = (...amounts: number[]) =>
    amounts.map((amount, i) => tender({ id: `t${i}`, amount, tendered: amount }));

  it('leaves an exactly-settled ticket untouched, by identity', () => {
    const t = rows(40, 60);
    expect(fitTendersToTotal(t, 10_000)).toBe(t);
  });

  it('leaves an UNDER-tendered ticket alone — the shortfall is Remaining', () => {
    const t = rows(40);
    expect(fitTendersToTotal(t, 10_000)).toBe(t);
  });

  it('trims the LAST-entered tender down to the new total', () => {
    const out = fitTendersToTotal(rows(40, 60), 7_000);
    expect(out.map((p) => p.amount)).toEqual([40, 30]);
    // The prefilled tendered follows the amount down, so no phantom change.
    expect(out[1].tendered).toBe(30);
    expect(changeDue([...out])).toBe(0);
  });

  it('drops whole tenders, newest first, until the ticket fits', () => {
    const out = fitTendersToTotal(rows(40, 30, 30), 4_000);
    expect(out.map((p) => p.amount)).toEqual([40]);
  });

  it('clears every tender when the cart empties to zero', () => {
    expect(fitTendersToTotal(rows(40, 60), 0)).toEqual([]);
  });

  it('keeps cash the customer actually handed over, and owes the change', () => {
    const out = fitTendersToTotal([tender({ amount: 100, tendered: 200 })], 6_000);
    expect(out[0].amount).toBe(60);
    expect(out[0].tendered).toBe(200);
    expect(changeDue([...out])).toBe(140);
  });

  it('never raises a short tender while trimming its amount', () => {
    const out = fitTendersToTotal([tender({ amount: 100, tendered: 50 })], 8_000);
    expect(out[0]).toMatchObject({ amount: 80, tendered: 50 });
  });

  it('sums tenders in cents, without float drift', () => {
    expect(tenderedCents([tender({ amount: 0.1 }), tender({ amount: 0.2 })])).toBe(30);
  });
});

describe('instalmentPrefillAmount — "Pay instalment" cart prefill', () => {
  it('prefills the next due instalment, not the whole balance', () => {
    expect(instalmentPrefillAmount({ remaining: 300, nextDue: { amount: 100 } })).toBe(100);
  });

  it('falls back to the remaining balance with no schedule to read', () => {
    expect(instalmentPrefillAmount({ remaining: 300, nextDue: null })).toBe(300);
  });
});

describe('capDiscount — keeps a line/order discount reachable by the server', () => {
  it('passes a discount under the total through unchanged', () => {
    expect(capDiscount(20, 80)).toBe(20);
  });

  it('caps a discount that exceeds the total (S/ 800 typed on an S/ 80 line)', () => {
    expect(capDiscount(800, 80)).toBe(80);
  });

  it('is cent-exact, not float-drifted', () => {
    expect(capDiscount(10.005, 10)).toBe(10);
  });

  it('never goes negative for a negative input or total', () => {
    expect(capDiscount(-5, 80)).toBe(0);
    expect(capDiscount(5, -10)).toBe(0);
  });

  it('treats a non-finite discount as zero', () => {
    expect(capDiscount(NaN, 80)).toBe(0);
  });
});
