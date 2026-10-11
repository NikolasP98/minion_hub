import { describe, it, expect } from 'vitest';
import { isLowStock } from './stock-low';

describe('stock.low — isLowStock boundary', () => {
  it('qty above the reorder level is NOT low', () => {
    expect(isLowStock(11, 10)).toBe(false);
  });

  it('qty exactly at the reorder level IS low (boundary is inclusive)', () => {
    expect(isLowStock(10, 10)).toBe(true);
  });

  it('qty below the reorder level IS low', () => {
    expect(isLowStock(9, 10)).toBe(true);
  });

  it('no reorder policy (null) is never low', () => {
    expect(isLowStock(0, null)).toBe(false);
  });
});
