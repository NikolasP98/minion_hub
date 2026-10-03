import { describe, expect, it } from 'vitest';
import { PosError } from './errors';
import {
  moneyMinor,
  moneyNumber,
  requirePosCurrency,
  storedDecimalNumber,
  storedMinorNumber,
  supportedPosCurrencies,
} from './money';

describe('POS field-specific decimal adapters', () => {
  it.each(['9999999999.99', '-9999999999.99'])('admits bounded field %s', (input) => {
    expect(moneyNumber(input, { numeric12: true })).toBe(Number(input));
  });
  it.each(['9999999999.995', '-9999999999.995'])('rejects post-round overflow %s', (input) => {
    expect(() => moneyNumber(input, { numeric12: true })).toThrowError(
      expect.objectContaining({ code: 'invalid_amount' }),
    );
  });
  it('does not impose numeric(12,2) limits on unconstrained fields or aggregates', () => {
    expect(moneyNumber('10000000000.00')).toBe(10_000_000_000);
    expect(storedMinorNumber(2_000_000_000_000n)).toBe(20_000_000_000);
  });
  it.each([null, 'not-money', '90071992547409.91'])('rejects unsafe stored DTO %s', (input) => {
    expect(() => storedDecimalNumber(input)).toThrowError(
      expect.objectContaining({ code: 'invalid_stored_amount' }),
    );
  });
  it('preserves unrounded catalog prices until the line boundary', () => {
    expect(storedDecimalNumber('0.335')).toBe(0.335);
    expect(storedDecimalNumber('1.005')).toBe(1.005);
  });
  it('maps malformed and non-exact discount failures to the selected domain code', () => {
    for (const amount of ['bad', '1.005', NaN]) {
      expect(() => moneyMinor(amount, { exact: true, code: 'invalid_discount' })).toThrowError(
        expect.objectContaining({ code: 'invalid_discount' }),
      );
    }
  });
});

describe('server-authoritative fixed-scale POS currency policy', () => {
  it.each(['PEN', 'USD', 'EUR'])('accepts ISO scale-2 %s', (currency) => {
    expect(requirePosCurrency(` ${currency.toLowerCase()} `)).toBe(currency);
    expect(supportedPosCurrencies()).toContain(currency);
  });
  it.each(['JPY', 'KRW', 'KWD', 'BHD', 'ZZZ', 'S/', '', null])(
    'rejects unsupported %s',
    (currency) => {
      expect(() => requirePosCurrency(currency)).toThrowError(
        expect.objectContaining({ code: 'unsupported_pos_currency' }),
      );
    },
  );
  it('returns an immutable bounded list for the settings read contract', () => {
    const currencies = supportedPosCurrencies();
    expect(currencies.length).toBeGreaterThan(10);
    expect(currencies.length).toBeLessThan(300);
    expect(Object.isFrozen(currencies)).toBe(true);
    expect(new Set(currencies).size).toBe(currencies.length);
    expect(currencies.every((value) => /^[A-Z]{3}$/.test(value))).toBe(true);
    expect(() => requirePosCurrency('JPY')).toThrow(PosError);
  });
});
