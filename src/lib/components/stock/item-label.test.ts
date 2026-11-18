import { describe, expect, it } from 'vitest';
import { itemLabel } from './item-label';

describe('itemLabel', () => {
  it('puts the name before the code', () => {
    expect(itemLabel({ name: 'Toxina Botulinica Dysport', code: '1258' }, 'x')).toBe(
      'Toxina Botulinica Dysport · 1258',
    );
  });
  it('shows the name alone when the item has no code', () => {
    expect(itemLabel({ name: 'Faja', code: '' }, 'x')).toBe('Faja');
    expect(itemLabel({ name: 'Faja', code: null }, 'x')).toBe('Faja');
  });
  it('keeps the fallback for an unresolved item', () => {
    expect(itemLabel(undefined, 'item-id')).toBe('item-id');
  });
});
