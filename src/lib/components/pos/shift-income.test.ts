import { describe, expect, it } from 'vitest';
import { incomeTotal, methodIncome, paymentsOfMethod, type ShiftPaymentRow } from './shift-income';

const methods = [
  { id: 'cash', label: 'Efectivo' },
  { id: 'card', label: 'Tarjeta' },
  { id: 'transfer', label: 'Transferencia' },
];

function payment(over: Partial<ShiftPaymentRow> = {}): ShiftPaymentRow {
  return {
    id: 'pay-1',
    ticketId: 't-1',
    humanId: 'B001-1',
    customerName: 'Ana',
    method: 'cash',
    amount: 100,
    paidAt: '2026-10-10T15:00:00.000Z',
    ...over,
  };
}

describe('methodIncome', () => {
  it('keeps the register method order and only lists methods that took money', () => {
    expect(methodIncome({ card: 50, cash: 20 }, methods)).toEqual([
      { id: 'cash', label: 'Efectivo', total: 20 },
      { id: 'card', label: 'Tarjeta', total: 50 },
    ]);
  });

  it('still lists money taken by a method that is no longer configured', () => {
    expect(methodIncome({ yape: 30 }, methods)).toEqual([{ id: 'yape', label: 'yape', total: 30 }]);
  });

  it('keeps a zero-total method that is present in the breakdown', () => {
    expect(methodIncome({ cash: 0 }, methods)).toEqual([
      { id: 'cash', label: 'Efectivo', total: 0 },
    ]);
  });
});

describe('incomeTotal', () => {
  it('sums in minor units rather than accumulating floats', () => {
    expect(incomeTotal({ cash: 0.1, card: 0.2 })).toBe(0.3);
    expect(incomeTotal({ cash: 4200.55, card: 99.45 })).toBe(4300);
    expect(incomeTotal({})).toBe(0);
  });
});

describe('paymentsOfMethod', () => {
  it('returns only that method rows, in the order given', () => {
    const rows = [payment({ id: 'a' }), payment({ id: 'b', method: 'card' }), payment({ id: 'c' })];
    expect(paymentsOfMethod(rows, 'cash').map((r) => r.id)).toEqual(['a', 'c']);
    expect(paymentsOfMethod(rows, 'transfer')).toEqual([]);
  });
});
