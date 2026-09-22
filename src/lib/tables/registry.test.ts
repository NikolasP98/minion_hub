import { describe, it, expect } from 'vitest';
import { applyTablePatch, formatId, resolveTable, type TableDef } from './registry';

const items: TableDef = {
  id: 'stock.items',
  module: 'stock',
  label: () => 'Items',
  idPrefix: 'ITM-',
  hasId: true,
  fields: [
    { key: 'name', label: () => 'Name', editable: true },
    { key: 'uom', label: () => 'Unit' },
  ],
};

describe('resolveTable', () => {
  it('falls back to registry defaults when the org has no overrides', () => {
    const r = resolveTable(items, {});
    expect(r.idPrefix).toBe('ITM-');
    expect(r.fields.get('name')).toEqual({ label: 'Name', hidden: undefined, editable: true });
    expect(r.fields.get('uom')?.editable).toBe(true);
  });
  it('applies label / hidden / editable-off overrides; editable can never be switched ON', () => {
    const r = resolveTable(items, {
      'stock.items': {
        idPrefix: 'INS-',
        fields: { name: { label: 'Producto', editable: false }, uom: { hidden: true } },
      },
    });
    expect(r.idPrefix).toBe('INS-');
    expect(r.fields.get('name')).toEqual({ label: 'Producto', hidden: undefined, editable: false });
    expect(r.fields.get('uom')?.hidden).toBe(true);
    expect(r.fields.get('uom')?.editable).toBe(true);
  });
});

describe('formatId', () => {
  it('joins prefix and code, and renders nothing for an empty code', () => {
    expect(formatId('ITM-', 1261)).toBe('ITM-1261');
    expect(formatId('', 'EUDA')).toBe('EUDA');
    expect(formatId('ITM-', null)).toBe('');
    expect(formatId('ITM-', '  ')).toBe('');
  });
});

describe('applyTablePatch', () => {
  it('stores only real customisation and drops overrides equal to the default', () => {
    let doc = applyTablePatch({}, [items], { 'stock.items': { idPrefix: 'INS-' } });
    expect(doc).toEqual({ 'stock.items': { idPrefix: 'INS-' } });
    doc = applyTablePatch(doc, [items], { 'stock.items': { idPrefix: 'ITM-' } });
    expect(doc).toEqual({});
  });
  it('merges field patches, trims, clamps, and ignores unknown tables and fields', () => {
    const doc = applyTablePatch({}, [items], {
      'stock.items': {
        fields: {
          name: { label: '  Producto  ' },
          uom: { hidden: true },
          nope: { hidden: true },
        },
      },
      'ghost.table': { idPrefix: 'X-' },
    });
    expect(doc).toEqual({
      'stock.items': { fields: { name: { label: 'Producto' }, uom: { hidden: true } } },
    });
    const longer = applyTablePatch(doc, [items], {
      'stock.items': { idPrefix: 'ABCDEFGHIJKLMNOP' },
    });
    expect(longer['stock.items']?.idPrefix).toBe('ABCDEFGHIJKL');
  });
  it('editable:false sticks only on fields the code marks editable; re-enabling clears it', () => {
    let doc = applyTablePatch({}, [items], {
      'stock.items': { fields: { name: { editable: false }, uom: { editable: false } } },
    });
    expect(doc).toEqual({ 'stock.items': { fields: { name: { editable: false } } } });
    doc = applyTablePatch(doc, [items], {
      'stock.items': { fields: { name: { editable: true } } },
    });
    expect(doc).toEqual({});
  });
});
