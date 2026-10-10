import { describe, expect, it } from 'vitest';
import {
  autofillPartyId,
  binKey,
  convertRates,
  mergePickedLine,
  previewStockChange,
  unitRate,
  type EntryLine,
} from './entry-lines';

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

describe('rate mode', () => {
  const line = (qty: string, rate: string) => ({
    itemId: 'a',
    qty,
    rate,
    fromWarehouseId: '',
    toWarehouseId: '',
  });

  it('unitRate divides a line total by qty and passes a unit rate through', () => {
    expect(unitRate('30', '3', 'total')).toBe(10);
    expect(unitRate('10', '3', 'unit')).toBe(10);
    expect(unitRate('', '3', 'total')).toBeNull();
    expect(unitRate('30', '0', 'total')).toBe(30);
  });

  it('convertRates round-trips without changing meaning', () => {
    const unit = [line('3', '10'), line('2', '')];
    const total = convertRates(unit, 'unit', 'total');
    expect(total.map((l) => l.rate)).toEqual(['30', '']);
    expect(convertRates(total, 'total', 'unit').map((l) => l.rate)).toEqual(['10', '']);
    expect(convertRates(unit, 'unit', 'unit')).toBe(unit);
  });
});

describe('previewStockChange', () => {
  // 15 caja on hand in w1, 3 in w2.
  const onHand = new Map([
    [binKey('item-1', 'w1'), 15],
    [binKey('item-1', 'w2'), 3],
  ]);
  const plain = { uom: 'unit' };
  const boxed = { uom: 'caja', consumptionUom: 'ml', unitsPerStockUom: '500' };

  it('adds to the destination bin on a receipt, in the stock uom', () => {
    expect(
      previewStockChange('receipt', line({ qty: '3', toWarehouseId: 'w1' }), plain, onHand),
    ).toEqual({
      uom: 'unit',
      legs: [{ warehouseId: 'w1', before: 15, after: 18, delta: 3 }],
      equivalent: null,
    });
  });

  it('expresses a converted item in its consumption unit too', () => {
    const p = previewStockChange('receipt', line({ qty: '3', toWarehouseId: 'w1' }), boxed, onHand);
    expect(p?.uom).toBe('caja');
    expect(p?.legs).toEqual([{ warehouseId: 'w1', before: 15, after: 18, delta: 3 }]);
    expect(p?.equivalent).toEqual({ qty: 1500, uom: 'ml' });
  });

  it('subtracts on an issue', () => {
    expect(
      previewStockChange('issue', line({ qty: '4', fromWarehouseId: 'w1' }), plain, onHand)?.legs,
    ).toEqual([{ warehouseId: 'w1', before: 15, after: 11, delta: -4 }]);
  });

  it('shows both sides of a transfer', () => {
    expect(
      previewStockChange(
        'transfer',
        line({ qty: '2', fromWarehouseId: 'w1', toWarehouseId: 'w2' }),
        plain,
        onHand,
      )?.legs,
    ).toEqual([
      { warehouseId: 'w1', before: 15, after: 13, delta: -2 },
      { warehouseId: 'w2', before: 3, after: 5, delta: 2 },
    ]);
  });

  it('follows the single side an adjustment sets', () => {
    expect(
      previewStockChange('adjustment', line({ qty: '1', fromWarehouseId: 'w2' }), plain, onHand)
        ?.legs,
    ).toEqual([{ warehouseId: 'w2', before: 3, after: 2, delta: -1 }]);
  });

  it('treats a bin with no row as a true zero (stk_bins is a complete cache)', () => {
    expect(
      previewStockChange('receipt', line({ qty: '5', toWarehouseId: 'w9' }), plain, onHand)?.legs,
    ).toEqual([{ warehouseId: 'w9', before: 0, after: 5, delta: 5 }]);
  });

  it('previews nothing until the line is previewable', () => {
    const complete = line({ qty: '1', toWarehouseId: 'w1' });
    expect(previewStockChange(null, complete, plain, onHand)).toBeNull();
    expect(previewStockChange('receipt', complete, undefined, onHand)).toBeNull();
    expect(
      previewStockChange('receipt', line({ qty: '0', toWarehouseId: 'w1' }), plain, onHand),
    ).toBeNull();
    // no warehouse picked yet (a fresh adjustment row has neither side)
    expect(previewStockChange('adjustment', line({ qty: '2' }), plain, onHand)).toBeNull();
  });

  it('skips the consumption equivalent when the factor or the unit is missing', () => {
    const l = line({ qty: '3', toWarehouseId: 'w1' });
    expect(
      previewStockChange('receipt', l, { uom: 'caja', consumptionUom: 'ml' }, onHand)?.equivalent,
    ).toBeNull();
    expect(
      previewStockChange(
        'receipt',
        l,
        { uom: 'ml', consumptionUom: 'ml', unitsPerStockUom: 1 },
        onHand,
      )?.equivalent,
    ).toBeNull();
  });
});

describe('autofillPartyId', () => {
  const base = {
    type: 'receipt' as const,
    partyId: null,
    providerAutofilled: false,
    itemSupplierPartyId: 'party-1',
  };

  it('fills from a ?item= prefilled line on load', () => {
    expect(autofillPartyId(base)).toBe('party-1');
  });

  it('fills from the first item picked', () => {
    expect(autofillPartyId({ ...base, itemSupplierPartyId: 'party-2' })).toBe('party-2');
  });

  it('leaves the second pick alone', () => {
    expect(
      autofillPartyId({ ...base, providerAutofilled: true, itemSupplierPartyId: 'party-2' }),
    ).toBeNull();
  });

  it('leaves a cleared picker alone once it has run', () => {
    expect(autofillPartyId({ ...base, providerAutofilled: true, partyId: null })).toBeNull();
  });

  it('never overwrites a party already set', () => {
    expect(autofillPartyId({ ...base, partyId: 'chosen-by-hand' })).toBeNull();
  });

  it('only autofills receipts', () => {
    for (const type of ['issue', 'transfer', 'adjustment'] as const)
      expect(autofillPartyId({ ...base, type })).toBeNull();
    expect(autofillPartyId({ ...base, type: null })).toBeNull();
  });

  it('does nothing when the item has no standing supplier', () => {
    expect(autofillPartyId({ ...base, itemSupplierPartyId: null })).toBeNull();
    expect(autofillPartyId({ ...base, itemSupplierPartyId: undefined })).toBeNull();
  });
});
