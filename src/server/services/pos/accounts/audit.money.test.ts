import { describe, expect, it } from 'vitest';
import { toMinorString } from './audit';

describe('toMinorString', () => {
  it.each([
    ['100.00', '10000'],
    ['0', '0'],
    ['0.5', '50'],
    ['12', '1200'],
    ['-0.50', '-50'],
    ['-0.00', '0'],
    ['1.10', '110'],
  ])('%s -> %s', (input, expected) => expect(toMinorString(input)).toBe(expected));
  it('refuses sub-minor precision and non-decimal text', () => {
    expect(() => toMinorString('1.005')).toThrow();
    expect(() => toMinorString('1e3')).toThrow();
    expect(() => toMinorString('')).toThrow();
  });
});
