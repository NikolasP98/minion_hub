import { describe, expect, it } from 'vitest';
import { mergePickedLine, type EntryLine } from './entry-lines';

function line(overrides: Partial<EntryLine> = {}): EntryLine {
  return {
    itemId: 'item-1',
    qty: '1',
    rate: '',
    fromWarehouseId: '',
    toWarehouseId: '',
    ...overrides,
  };
}

describe('mergePickedLine', () => {
  it('adds a new line when the item has no existing line', () => {
    const { lines, mergedIndex } = mergePickedLine([], 'item-1', () => line());
    expect(lines).toEqual([line()]);
    expect(mergedIndex).toBeNull();
  });

  it('increments qty instead of duplicating when the item is already a line', () => {
    const existing = [line({ qty: '2' })];
    const { lines, mergedIndex } = mergePickedLine(existing, 'item-1', () => line());
    expect(lines).toHaveLength(1);
    expect(lines[0].qty).toBe('3');
    expect(mergedIndex).toBe(0);
  });

  it('merges into the matching line, leaving other items untouched', () => {
    const existing = [line({ itemId: 'other' }), line({ qty: '1' })];
    const { lines, mergedIndex } = mergePickedLine(existing, 'item-1', () => line());
    expect(lines[0]).toEqual(line({ itemId: 'other' }));
    expect(lines[1].qty).toBe('2');
    expect(mergedIndex).toBe(1);
  });

  it('increments by the picked qty when provided', () => {
    const existing = [line({ qty: '1' })];
    const { lines } = mergePickedLine(existing, 'item-1', () => line(), 3);
    expect(lines[0].qty).toBe('4');
  });

  it('leaves a deliberate two-warehouse split alone and adds a new line', () => {
    const existing = [line({ fromWarehouseId: 'wh-a' }), line({ toWarehouseId: 'wh-b' })];
    const { lines, mergedIndex } = mergePickedLine(existing, 'item-1', () =>
      line({ toWarehouseId: 'wh-c' }),
    );
    expect(lines).toHaveLength(3);
    expect(mergedIndex).toBeNull();
  });

  it('merges when the existing matches have no warehouse set yet', () => {
    // Freshly-picked lines for adjustments start with both warehouse sides
    // empty (the user hasn't chosen a side yet) — that's not a deliberate
    // split, so a second pick of the same item still merges.
    const existing = [line(), line()];
    const { lines, mergedIndex } = mergePickedLine(existing, 'item-1', () => line());
    expect(lines).toHaveLength(2);
    expect(mergedIndex).toBe(0);
    expect(lines[0].qty).toBe('2');
  });
});
