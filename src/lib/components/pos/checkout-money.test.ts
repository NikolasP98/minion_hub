import { describe, expect, it } from 'vitest';
import { changeDue, rowChange, type PaymentRow } from './PaymentPanel.svelte';
import { lineCents, lineKey, lineNeedsPrice, type CartLine } from './SellCart.svelte';
import {
  CheckoutMoneyDraftError,
  cartMoneyState,
  checkoutLineState,
  fitTendersToTotal,
  instalmentPrefillAmount,
  moneyDraft,
  paymentRowsState,
  planDueSchedule,
  remainingMoneyState,
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

describe('checked checkout drafts', () => {
  it('quantizes an exact raw principal once and rejects lossy numeric wires', () => {
    expect(moneyDraft('1.005', { positive: true })).toEqual({
      ok: true,
      value: { minor: 101n, number: 1.01 },
    });
    expect(moneyDraft('1.005', { exact: true })).toEqual({
      ok: false,
      code: 'invalid_amount',
    });
    expect(moneyDraft('90071992547409.91')).toEqual({ ok: false, code: 'invalid_amount' });
    expect(moneyDraft('', { positive: true })).toEqual({ ok: false, code: 'invalid_amount' });
  });

  it('enforces the numeric(12,2) UI boundary for principal and ledger drafts', () => {
    expect(moneyDraft('9999999999.99', { numeric12: true }).ok).toBe(true);
    expect(moneyDraft('9999999999.995', { numeric12: true })).toEqual({
      ok: false,
      code: 'invalid_amount',
    });
  });
});

describe('ticket line parity', () => {
  it('quantizes quantity times unrounded price once', () => {
    const state = checkoutLineState(line({ qty: '3', unitPrice: '0.335', discount: '1.00' }));
    expect(state).toMatchObject({
      ok: true,
      value: { grossMinor: 101n, discountMinor: 100n, totalMinor: 1n, total: 0.01 },
    });
    expect(lineCents(line({ qty: '3', unitPrice: '0.335', discount: '1.00' }))).toBe(1);
  });

  it('accepts the full displayed gross but rejects excess and sub-cent discounts', () => {
    expect(checkoutLineState(line({ qty: 3, unitPrice: '0.335', discount: '1.01' }))).toMatchObject(
      {
        ok: true,
        value: { totalMinor: 0n },
      },
    );
    expect(checkoutLineState(line({ qty: 3, unitPrice: '0.335', discount: '1.02' }))).toEqual({
      ok: false,
      code: 'invalid_discount',
    });
    expect(checkoutLineState(line({ qty: 3, unitPrice: '0.335', discount: '0.001' }))).toEqual({
      ok: false,
      code: 'invalid_discount',
    });
  });

  it('charges a zero-price line and only blocks one with no price set', () => {
    expect(lineNeedsPrice(line({ unitPrice: 0 }))).toBe(false);
    expect(lineNeedsPrice(line({ unitPrice: '0' }))).toBe(false);
    expect(lineNeedsPrice(line({ unitPrice: 0, redemptionId: 'r1' }))).toBe(false);
    expect(lineCents(line({ unitPrice: 0 }))).toBe(0);
    expect(lineCents(line({ unitPrice: '0', qty: 3 }))).toBe(0);
    expect(checkoutLineState(line({ unitPrice: 0 }))).toMatchObject({
      ok: true,
      value: { totalMinor: 0n },
    });
    expect(cartMoneyState([line({ unitPrice: 0 }), line({ unitPrice: '0' })])).toMatchObject({
      ok: true,
      value: { totalMinor: 0n, total: 0 },
    });

    expect(lineNeedsPrice(line({ unitPrice: null }))).toBe(true);
    expect(checkoutLineState(line({ unitPrice: null }))).toEqual({
      ok: false,
      code: 'missing_price',
    });
    expect(checkoutLineState(line({ unitPrice: -1 }))).toEqual({
      ok: false,
      code: 'invalid_amount',
    });
  });

  it('reports the exact failing line and never substitutes a zero total', () => {
    expect(cartMoneyState([line(), line({ discount: 'broken' })])).toEqual({
      ok: false,
      code: 'invalid_discount',
      index: 1,
    });
  });
});

describe('planDueSchedule', () => {
  const sumCents = (rows: { amount: number }[]) =>
    rows.reduce((sum, row) => sum + Math.round(row.amount * 100), 0);

  it('allocates every cent for awkward totals', () => {
    for (const total of ['100', '100.01', '0.07', '999.99', '1234.56']) {
      for (const count of [1, 2, 3, 6, 7, 12]) {
        const expected = moneyDraft(total, { positive: true });
        expect(expected.ok).toBe(true);
        if (expected.ok)
          expect(sumCents(planDueSchedule(total, count))).toBe(Number(expected.value.minor));
      }
    }
  });

  it('assigns residual cents to the earliest rows and omits zero rows', () => {
    expect(planDueSchedule('100', 3, new Date(2026, 0, 10)).map((row) => row.amount)).toEqual([
      33.34, 33.33, 33.33,
    ]);
    expect(planDueSchedule('0.02', 5)).toHaveLength(2);
  });

  it('clamps short months and rolls into the next year', () => {
    expect(planDueSchedule('300', 3, new Date(2026, 0, 31)).map((row) => row.dueOn)).toEqual([
      '2026-01-31',
      '2026-02-28',
      '2026-03-31',
    ]);
    expect(planDueSchedule('200', 2, new Date(2026, 11, 5)).map((row) => row.dueOn)).toEqual([
      '2026-12-05',
      '2027-01-05',
    ]);
  });

  it('rejects nonpositive principal and invalid row counts', () => {
    expect(() => planDueSchedule('0', 3)).toThrow(CheckoutMoneyDraftError);
    expect(() => planDueSchedule('100', 1.5)).toThrow(CheckoutMoneyDraftError);
    expect(() => planDueSchedule('100', 366)).toThrow(CheckoutMoneyDraftError);
  });
});

describe('payment drafts and change', () => {
  it('computes cash change in integer minor units', () => {
    expect(rowChange(tender({ amount: '87.40', tendered: '100' }))).toBe(12.6);
    expect(
      changeDue([
        tender({ amount: '0.10', tendered: '0.30' }),
        tender({ amount: '0.10', tendered: '0.30' }),
      ]),
    ).toBe(0.4);
  });

  it('reports invalid raw amounts and insufficient cash instead of zero', () => {
    expect(paymentRowsState([tender({ amount: '' })])).toEqual({
      ok: false,
      code: 'invalid_amount',
      index: 0,
    });
    expect(paymentRowsState([tender({ amount: '10', tendered: '9.99' })])).toEqual({
      ok: false,
      code: 'invalid_tender',
      index: 0,
    });
    expect(rowChange(tender({ amount: 'broken' }))).toBeNull();
    expect(() => tenderedCents([tender({ amount: 'broken' })])).toThrow(CheckoutMoneyDraftError);
  });

  it('reports a non-roundtrippable remainder without throwing the checkout route', () => {
    const cart = cartMoneyState([line({ qty: '1', unitPrice: '90071992547408', discount: '0' })]);
    const payment = paymentRowsState([tender({ amount: '0.01', tendered: '0.01' })]);
    expect(cart.ok).toBe(true);
    expect(payment.ok).toBe(true);
    if (!cart.ok || !payment.ok) throw new Error('fixture must be individually representable');

    expect(remainingMoneyState(cart.value.totalMinor, payment.value.paidMinor)).toEqual({
      ok: false,
      code: 'invalid_amount',
    });
  });
});

describe('fitTendersToTotal', () => {
  const rows = (...amounts: number[]) =>
    amounts.map((amount, index) => tender({ id: `t${index}`, amount, tendered: amount }));

  it('leaves exact and under-tendered rows untouched by identity', () => {
    const exact = rows(40, 60);
    expect(fitTendersToTotal(exact, 10_000n)).toBe(exact);
    const short = rows(40);
    expect(fitTendersToTotal(short, 10_000n)).toBe(short);
  });

  it('trims newest rows first and preserves real cash in hand', () => {
    const trimmed = fitTendersToTotal(rows(40, 60), 7_000n);
    expect(trimmed.map((payment) => payment.amount)).toEqual([40, 30]);
    expect(trimmed[1].tendered).toBe(30);
    expect(changeDue(trimmed)).toBe(0);

    const cash = fitTendersToTotal([tender({ amount: 100, tendered: 200 })], 6_000n);
    expect(cash[0]).toMatchObject({ amount: 60, tendered: 200 });
    expect(changeDue(cash)).toBe(140);
  });

  it('drops absorbed rows and leaves invalid drafts untouched', () => {
    expect(fitTendersToTotal(rows(40, 30, 30), 4_000n).map((payment) => payment.amount)).toEqual([
      40,
    ]);
    const invalid = [tender({ amount: 'not-money' })];
    expect(fitTendersToTotal(invalid, 1_000n)).toBe(invalid);
    const valid = rows(10);
    expect(fitTendersToTotal(valid, Number.NaN)).toBe(valid);
    expect(fitTendersToTotal(valid, -1n)).toBe(valid);
  });
});

describe('instalmentPrefillAmount', () => {
  it('caps a valid next due row to the positive remaining principal', () => {
    expect(instalmentPrefillAmount({ remaining: 300, nextDue: { amount: 100 } })).toBe(100);
    expect(instalmentPrefillAmount({ remaining: 40, nextDue: { amount: 60 } })).toBe(40);
  });

  it('uses positive remaining for no schedule or an invalid legacy schedule', () => {
    expect(instalmentPrefillAmount({ remaining: 300, nextDue: null })).toBe(300);
    expect(
      instalmentPrefillAmount({
        remaining: 300,
        nextDue: null,
        scheduleIssue: 'principal_mismatch',
      }),
    ).toBe(300);
  });

  it('returns null for settled, overpaid or invalid remaining values', () => {
    expect(instalmentPrefillAmount({ remaining: 0, nextDue: null })).toBeNull();
    expect(instalmentPrefillAmount({ remaining: -1, nextDue: null })).toBeNull();
    expect(instalmentPrefillAmount({ remaining: 'bad', nextDue: null })).toBeNull();
  });
});

describe('lineKey', () => {
  const sellable = { productId: 'svc-1', unitPrice: 50 } as unknown as CartLine['sellable'];

  it('keeps booked sessions separate from walk-in lines of the same treatment', () => {
    const walkIn: CartLine = { sellable, qty: 1, unitPrice: 50, discount: 0 };
    const keys = new Set(
      [walkIn, { ...walkIn, bookingId: 'bk-1' }, { ...walkIn, bookingId: 'bk-2' }].map(lineKey),
    );
    expect(keys.size).toBe(3);
  });

  it('keys package and instalment lines on their own ids', () => {
    const base: CartLine = { sellable, qty: 1, unitPrice: 50, discount: 0 };
    expect(lineKey({ ...base, planId: 'p1', bookingId: 'bk-1' })).toBe('p1');
    expect(lineKey({ ...base, redemptionId: 'r1' })).toBe('r1');
  });
});
