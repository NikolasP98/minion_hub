import { describe, expect, it } from 'vitest';
import { mergeFieldLayout, moveField, visibleFields } from './card-fields';

const CATALOG = ['code', 'price', 'kind', 'stock'];

describe('mergeFieldLayout', () => {
  it('starts from the catalog order with the surface defaults hidden', () => {
    const layout = mergeFieldLayout(CATALOG, null, ['code']);
    expect(layout.order).toEqual(CATALOG);
    expect([...layout.hidden]).toEqual(['code']);
    expect(visibleFields(layout)).toEqual(['price', 'kind', 'stock']);
  });

  it('keeps the viewer order, drops retired keys, slots a new field at its catalog position', () => {
    const layout = mergeFieldLayout(
      CATALOG,
      { order: ['stock', 'retired', 'code'], hidden: ['retired', 'kind'] },
      ['code'],
    );
    // stored first (minus 'retired'), then catalog keys it never mentioned in catalog order
    expect(layout.order).toEqual(['stock', 'code', 'price', 'kind']);
    // a stored hidden set replaces the defaults entirely — the viewer chose
    expect([...layout.hidden]).toEqual(['kind']);
  });
});

describe('moveField', () => {
  it('moves a key into the target slot and ignores unknown targets', () => {
    expect(moveField(CATALOG, 'stock', 'code')).toEqual(['stock', 'code', 'price', 'kind']);
    expect(moveField(CATALOG, 'code', 'kind')).toEqual(['price', 'code', 'kind', 'stock']);
    expect(moveField(CATALOG, 'code', 'nope')).toEqual(CATALOG);
    expect(moveField(CATALOG, 'code', 'code')).toEqual(CATALOG);
  });
});
