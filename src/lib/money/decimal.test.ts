import { describe, expect, it } from 'vitest';
import oracle from './decimal-oracle.json';
import {
  allocateMinorUnits,
  DecimalInputError,
  decimalToMinor,
  decimalToMinorExact,
  decimalToNumber,
  divideDecimalToMinor,
  minorToDecimal,
  minorToNumber,
  multiplyDecimalToMinor,
  sumDecimalToMinor,
} from './decimal';

function rejects(work: () => unknown, reason: DecimalInputError['reason']) {
  expect(work).toThrowError(expect.objectContaining({ name: 'DecimalInputError', reason }));
}

describe('independent Python Decimal oracle (seed 20261003)', () => {
  it.each(oracle.quantize)('quantizes $input at scale $scale as $expected', (row) => {
    expect(minorToDecimal(decimalToMinor(row.input, row.scale), row.scale)).toBe(row.expected);
  });

  it.each(oracle.lines)('rounds $qty × $price once, then subtracts $discount', (row) => {
    const gross = multiplyDecimalToMinor(row.qty, row.price);
    const discount = decimalToMinorExact(row.discount);
    expect(minorToDecimal(gross - discount)).toBe(row.expected);
  });

  it.each(oracle.allocations)('conserves $input across $count signed slots', (row) => {
    const total = decimalToMinor(row.input, row.scale);
    const slots = allocateMinorUnits(total, row.count);
    expect(slots.map(String)).toEqual(row.expectedMinor);
    expect(slots.reduce((sum, value) => sum + value, 0n)).toBe(total);
    expect(slots.length).toBe(row.count);
  });
});

describe('bounded grammar and exact conversions', () => {
  it.each(['+.5', '000.50', '5e-1', '5E-1', '  \t0.5\r\n'])('accepts %j', (input) => {
    expect(decimalToMinor(input)).toBe(50n);
    expect(decimalToNumber(input)).toBe(0.5);
  });
  it.each(['1.', '+1', '1E+0', '1e00000000'])('accepts integer spelling %j', (input) => {
    expect(decimalToMinor(input)).toBe(100n);
  });
  it.each(['', ' ', '.', '-', '1 2', '1,000', '0x10', '1_000', '\u00a01', '１２', '1e'])(
    'rejects malformed %j',
    (input) => rejects(() => decimalToMinor(input), 'invalid_decimal'),
  );
  it.each([NaN, Infinity, -Infinity])('rejects nonfinite %s', (input) => {
    rejects(() => decimalToMinor(input), 'invalid_decimal');
  });
  it('rejects nullish and nonnumeric runtime input rather than manufacturing zero', () => {
    for (const value of [null, undefined, true, {}, []]) {
      rejects(() => decimalToMinor(value as never), 'invalid_decimal');
    }
  });
  it('bounds length, coefficient padding, exponents, scales and collections before work', () => {
    for (const input of [' '.repeat(80) + '1', '0'.repeat(41), '1e19', '1e-19']) {
      rejects(() => decimalToMinor(input), 'decimal_limit');
    }
    for (const scale of [-1, 7, 1.5, NaN, Infinity]) {
      rejects(() => decimalToMinor('1', scale), 'invalid_scale');
    }
    for (const count of [0, -1, 10_001, 1.5, NaN, Infinity]) {
      rejects(() => allocateMinorUnits(1n, count), 'invalid_count');
    }
    rejects(() => sumDecimalToMinor(Array(10_001).fill('1')), 'invalid_count');
    rejects(() => minorToDecimal(10n ** 128n), 'decimal_limit');
  });
  it('normalizes negative zero without erasing a negative halfway result', () => {
    for (const value of ['-0', -0, '-0.000']) {
      expect(decimalToNumber(value)).toBe(0);
      expect(Object.is(decimalToNumber(value), -0)).toBe(false);
      expect(minorToDecimal(decimalToMinor(value))).toBe('0.00');
    }
    expect(decimalToMinor('-0.005')).toBe(-1n);
  });
  it('requires exact cents for schedules and discounts', () => {
    expect(decimalToMinorExact('1.0100')).toBe(101n);
    rejects(() => decimalToMinorExact('1.005'), 'invalid_decimal');
    rejects(() => decimalToMinorExact('-0.001'), 'invalid_decimal');
  });
  it('rejects safe-integer cents when their Number DTO would lose a cent', () => {
    const cents = 9_007_199_254_740_991n;
    expect(cents <= BigInt(Number.MAX_SAFE_INTEGER)).toBe(true);
    rejects(() => minorToNumber(cents), 'unsafe_number');
    rejects(() => decimalToNumber('90071992547409.91'), 'unsafe_number');
    rejects(() => minorToNumber(cents + 1n), 'unsafe_number');
    expect(decimalToNumber('0.335')).toBe(0.335);
    expect(decimalToNumber('1.005')).toBe(1.005);
    expect(minorToNumber(999_999_999_999n)).toBe(9_999_999_999.99);
    expect(minorToNumber(-999_999_999_999n)).toBe(-9_999_999_999.99);
  });
  it('sums original decimals before quantization and treats an empty ledger as zero', () => {
    expect(sumDecimalToMinor(['0.1', '0.2'])).toBe(30n);
    expect(sumDecimalToMinor(['0.005', '0.005'])).toBe(1n);
    expect(sumDecimalToMinor(['-0.005', '-0.005'])).toBe(-1n);
    expect(sumDecimalToMinor(['9999999999.99', '-9999999999.98'])).toBe(1n);
    expect(sumDecimalToMinor([])).toBe(0n);
  });
  it('divides rational operands exactly with symmetric tie rounding', () => {
    expect(divideDecimalToMinor('1.005', '1')).toBe(101n);
    expect(divideDecimalToMinor('-1.005', '1')).toBe(-101n);
    expect(divideDecimalToMinor('100', '3')).toBe(3333n);
    expect(divideDecimalToMinor('-0.05', '2')).toBe(-3n);
    expect(divideDecimalToMinor('-0.05', '-2')).toBe(3n);
    expect(divideDecimalToMinor('0.002', '0.1', 3)).toBe(20n);
    rejects(() => divideDecimalToMinor('1', '0'), 'invalid_decimal');
  });
});
