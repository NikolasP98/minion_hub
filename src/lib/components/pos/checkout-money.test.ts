import { describe, expect, it } from 'vitest';
import { changeDue, rowChange, type PaymentRow } from './PaymentPanel.svelte';
import { lineCents, lineNeedsPrice, type CartLine } from './SellCart.svelte';
import { fitTendersToTotal, tenderedCents } from './checkout-money';

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
