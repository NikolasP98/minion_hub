import { describe, expect, it } from 'vitest';
import {
  dayTotals,
  foldPayments,
  shiftsOnDay,
  type FoldablePayment,
  type TimedPayment,
} from './payments-fold';

const row = (p: Partial<FoldablePayment>): FoldablePayment => ({
  ticketId: 't1',
  shiftId: 's1',
  method: 'cash',
  amount: 100,
  refund: false,
  ...p,
});

const timedRow = (p: Partial<TimedPayment>): TimedPayment => ({
  ...row({}),
  at: '2026-10-14T18:00:00Z',
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

  it('reads a closed-shift tender correction as the corrected method (spec 2026-10-15 T3)', () => {
    const { byTicket, methodTotals } = foldPayments([
      row({ method: 'cash', amount: 100 }),
      row({ shiftId: 's2', method: 'cash', amount: -100 }),
      row({ shiftId: 's2', method: 'card', amount: 100 }),
    ]);
    expect(byTicket.get('t1')).toEqual([{ method: 'card', amount: 100 }]);
    // The selling shift keeps what it counted; the correcting shift carries the move.
    expect(methodTotals.s1).toEqual({ cash: 100 });
    expect(methodTotals.s2).toEqual({ cash: -100, card: 100 });
  });

  it('gives a ticket whose only row is a refund no payment methods', () => {
    const { byTicket, methodTotals } = foldPayments([row({ amount: -100, refund: true })]);
    expect(byTicket.get('t1')).toBeUndefined();
    expect(methodTotals.s1).toEqual({ cash: -100 });
  });
});

describe('dayTotals', () => {
  it('buckets by the org-local calendar day, not the UTC one', () => {
    // 23:30 Lima (UTC-5) on the 14th is 04:30Z on the 15th — must land on the 14th.
    const days = dayTotals([timedRow({ at: '2026-10-15T04:30:00Z', amount: 100 })], 'America/Lima');
    expect(Object.keys(days)).toEqual(['2026-10-14']);
    expect(days['2026-10-14']).toEqual({ total: 100, byMethod: { cash: 100 } });
  });

  it('nets a same-day refund into a negative total', () => {
    const days = dayTotals(
      [
        timedRow({ at: '2026-10-14T15:00:00Z', amount: 100 }),
        timedRow({ at: '2026-10-14T20:00:00Z', amount: -140, refund: true }),
      ],
      'America/Lima',
    );
    expect(days['2026-10-14']).toEqual({ total: -40, byMethod: { cash: -40 } });
  });
});

describe('shiftsOnDay', () => {
  it('collects every shift with a payment on the org-local day, deduped', () => {
    const ids = shiftsOnDay(
      [
        timedRow({ shiftId: 's1', at: '2026-10-14T15:00:00Z' }),
        timedRow({ shiftId: 's1', at: '2026-10-14T20:00:00Z' }),
        timedRow({ shiftId: 's2', at: '2026-10-14T23:00:00Z' }),
      ],
      'America/Lima',
      '2026-10-14',
    );
    expect(ids).toEqual(new Set(['s1', 's2']));
  });

  it('excludes a shift whose only payment lands on a different org-local day', () => {
    // 23:30 Lima (UTC-5) on the 14th is 04:30Z on the 15th — belongs to the 14th, not the 15th.
    const ids = shiftsOnDay(
      [timedRow({ shiftId: 's1', at: '2026-10-15T04:30:00Z' })],
      'America/Lima',
      '2026-10-15',
    );
    expect(ids.size).toBe(0);
  });
});
