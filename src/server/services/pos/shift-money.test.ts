import { describe, expect, it } from 'vitest';
import { checkedShift, computeExpected, moneyRecord } from './shift-money';

describe('shift money boundaries', () => {
  it('adds decimal opening cash to net cash payments without adding customer change again', () => {
    // A customer hands over 1.00 for a 0.20 sale: persisted payment amount is 0.20.
    expect(
      computeExpected({ notes: 0.2, card: 0.3 }, { notes: 0.1, card: 99 }, [
        { id: 'notes', takesTendered: true },
        { id: 'card', takesTendered: false },
      ]),
    ).toEqual({ notes: 0.3, card: 0.3 });
  });
  it('rounds opening/count input using the declared tie rule', () => {
    expect(moneyRecord({ cash: 1.005 }, 'input')).toEqual({ cash: 1.01 });
  });
  it.each([-0.001, -1, NaN, Infinity, null, 'bad', '90071992547409.91'])(
    'rejects invalid drawer input %s',
    (cash) => {
      expect(() => moneyRecord({ cash }, 'input')).toThrowError(
        expect.objectContaining({ code: 'invalid_amount' }),
      );
    },
  );
  it.each([null, [], 1, { cash: null }, { cash: '1.005' }, { cash: '90071992547409.91' }])(
    'rejects corrupt stored drawer %j',
    (raw) => {
      expect(() => moneyRecord(raw, 'stored')).toThrowError(
        expect.objectContaining({ code: 'invalid_stored_amount' }),
      );
    },
  );
  it('treats prototype-shaped method IDs as owned dictionary keys', () => {
    const expected = computeExpected(
      JSON.parse('{"__proto__":0.2}'),
      JSON.parse('{"__proto__":0.1}'),
      [{ id: '__proto__', takesTendered: true }],
    );
    expect(Object.hasOwn(expected, '__proto__')).toBe(true);
    expect(expected.__proto__).toBe(0.3);
    expect(Object.getPrototypeOf(expected)).toBe(Object.prototype);
  });
  it('checks every stored map while preserving an open shift without close amounts', () => {
    expect(checkedShift({ openingFloat: { cash: '0.10' }, counted: null, expected: null })).toEqual(
      { openingFloat: { cash: 0.1 }, counted: null, expected: null },
    );
    expect(() =>
      checkedShift({ openingFloat: {}, counted: { cash: 'bad' }, expected: {} }),
    ).toThrowError(expect.objectContaining({ code: 'invalid_stored_amount' }));
  });
});
