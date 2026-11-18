import { expect, it } from 'vitest';
import { mulDecimal } from './decimal';

it('multiplies exactly', () => {
  expect(mulDecimal('3', '0.1')).toBe('0.3');
  expect(mulDecimal('2', '12.3456789')).toBe('24.6913578');
  expect(mulDecimal('-1.5', '2')).toBe('-3');
  expect(mulDecimal('1.500', '2.00')).toBe('3');
  expect(mulDecimal('0', '-4.2')).toBe('0');
  expect(mulDecimal('0.001', '0.001')).toBe('0.000001');
  expect(mulDecimal('9007199254740993', '3')).toBe('27021597764222979');
});
it('returns null for non-decimal input', () => {
  expect(mulDecimal('abc', '1')).toBeNull();
  expect(mulDecimal('1e3', '1')).toBeNull();
});
