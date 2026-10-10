import { describe, expect, it } from 'vitest';
import { computeTicketMoney, lineMoneyMinor } from './ticket';

describe('shared checkout and server line policy', () => {
  it.each([
    [1, 0.01],
    [1.01, 0],
  ])('gross 1.005 and discount %s gives %s', (discount, total) => {
    expect(computeTicketMoney([{ qty: 1, unitPrice: 1.005, discount }])).toEqual({
      lineTotals: [total],
      subtotal: total,
      total,
      discount: 0,
    });
  });
  it.each([1.02, 1.001, -0.001, NaN])('retains invalid-discount error for %s', (discount) => {
    expect(() => lineMoneyMinor({ qty: 1, unitPrice: 1.005, discount })).toThrowError(
      expect.objectContaining({ code: 'invalid_discount' }),
    );
  });
  it('does not round unit price before multiplying', () => {
    expect(computeTicketMoney([{ qty: 3, unitPrice: '0.335' }]).total).toBe(1.01);
    expect(computeTicketMoney([{ qty: 0.3, unitPrice: 3.35 }]).total).toBe(1.01);
  });
  it('sums quantized line cents and quantizes order discount once', () => {
    expect(
      computeTicketMoney(
        [
          { qty: 1, unitPrice: 1.005 },
          { qty: 3, unitPrice: 0.335 },
        ],
        0.005,
      ),
    ).toEqual({ lineTotals: [1.01, 1.01], subtotal: 2.02, discount: 0.01, total: 2.01 });
  });
  it.each([NaN, Infinity, 0, -1, 'bad'])('rejects invalid quantity %s', (qty) => {
    expect(() => lineMoneyMinor({ qty, unitPrice: 10 })).toThrowError(
      expect.objectContaining({ code: 'invalid_qty' }),
    );
  });
  it.each([NaN, Infinity, '90071992547409.91'])('rejects unsafe price %s', (unitPrice) => {
    expect(() => lineMoneyMinor({ qty: 1, unitPrice })).toThrowError(
      expect.objectContaining({ code: 'invalid_amount' }),
    );
  });
  it('permits a zero price on any line, never a negative one', () => {
    expect(lineMoneyMinor({ qty: 1, unitPrice: 0 }).total).toBe(0n);
    expect(lineMoneyMinor({ qty: 2, unitPrice: 0, discount: 0 }).total).toBe(0n);
    expect(computeTicketMoney([{ qty: 1, unitPrice: 0 }])).toEqual({
      lineTotals: [0],
      subtotal: 0,
      discount: 0,
      total: 0,
    });
    expect(() => lineMoneyMinor({ qty: 1, unitPrice: -1 })).toThrowError(
      expect.objectContaining({ code: 'invalid_amount' }),
    );
  });
  it.each([-0.001, 10.01, NaN])(
    'rejects negative, excessive or invalid order discount %s',
    (discount) => {
      expect(() => computeTicketMoney([{ qty: 1, unitPrice: 10 }], discount)).toThrowError(
        expect.objectContaining({ code: 'invalid_discount' }),
      );
    },
  );
});
