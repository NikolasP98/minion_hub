import { describe, expect, it } from 'vitest';
import { foldPayments, type FoldablePayment } from './payments-fold';

const row = (p: Partial<FoldablePayment>): FoldablePayment => ({
  ticketId: 't1',
  shiftId: 's1',
  method: 'cash',
  amount: 100,
  refund: false,
  ...p,
});

describe('foldPayments', () => {
  it('reads a plain sale into both the ticket and its shift', () => {
    const { byTicket, methodTotals } = foldPayments([row({})]);
    expect(byTicket.get('t1')).toEqual([{ method: 'cash', amount: 100 }]);
    expect(methodTotals.s1).toEqual({ cash: 100 });
  });

  it('keeps a split ticket in payment order and sums its shift per method', () => {
    const { byTicket, methodTotals } = foldPayments([
      row({ method: 'cash', amount: 60 }),
      row({ method: 'yape', amount: 40 }),
      row({ ticketId: 't2', method: 'cash', amount: 25 }),
    ]);
    expect(byTicket.get('t1')).toEqual([
      { method: 'cash', amount: 60 },
      { method: 'yape', amount: 40 },
    ]);
    expect(methodTotals.s1).toEqual({ cash: 85, yape: 40 });
  });

  it('nets a same-shift cash refund to zero without touching how the ticket was paid', () => {
    const { byTicket, methodTotals } = foldPayments([
      row({ amount: 100 }),
      row({ amount: -100, refund: true }),
    ]);
    expect(byTicket.get('t1')).toEqual([{ method: 'cash', amount: 100 }]);
    expect(methodTotals.s1).toEqual({ cash: 0 });
  });

  it('charges a later refund to the shift that issued it, not the one that sold', () => {
    const { byTicket, methodTotals } = foldPayments([
      row({ shiftId: 'sold', amount: 100 }),
      row({ shiftId: 'refunded', amount: -100, refund: true }),
    ]);
    expect(byTicket.get('t1')).toEqual([{ method: 'cash', amount: 100 }]);
    expect(methodTotals.sold).toEqual({ cash: 100 });
    expect(methodTotals.refunded).toEqual({ cash: -100 });
  });

  it('gives a ticket whose only row is a refund no payment methods', () => {
    const { byTicket, methodTotals } = foldPayments([row({ amount: -100, refund: true })]);
    expect(byTicket.get('t1')).toBeUndefined();
    expect(methodTotals.s1).toEqual({ cash: -100 });
  });
});
