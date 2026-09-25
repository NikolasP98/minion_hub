import { describe, expect, it } from 'vitest';
import {
  HOVER_FIELDS,
  mergeHoverFields,
  moveHoverField,
  visibleHoverFields,
  type HoverField,
} from './hover-fields';

describe('mergeHoverFields', () => {
  it('falls back to the default order with nothing hidden', () => {
    const { hidden, order } = mergeHoverFields(null);
    expect(order).toEqual([...HOVER_FIELDS]);
    expect([...hidden]).toEqual([]);
  });

  it('drops unknown keys from both order and hidden', () => {
    const { hidden, order } = mergeHoverFields({
      order: ['client', 'gone', 'status'],
      hidden: ['chips', 'gone'],
    });
    expect(order.slice(0, 2)).toEqual(['client', 'status']);
    expect(order).not.toContain('gone');
    expect([...hidden]).toEqual(['chips']);
  });

  it('appends keys the stored prefs never knew about, in default order', () => {
    const { order } = mergeHoverFields({ order: ['actions', 'title'], hidden: [] });
    expect(order).toEqual([
      'actions',
      'title',
      ...HOVER_FIELDS.filter((k) => k !== 'actions' && k !== 'title'),
    ]);
    expect(new Set(order).size).toBe(HOVER_FIELDS.length);
  });

  it('collapses duplicates', () => {
    const { order } = mergeHoverFields({ order: ['phone', 'phone', 'staff'], hidden: [] });
    expect(order.filter((k) => k === 'phone')).toHaveLength(1);
  });
});

describe('visibleHoverFields', () => {
  it('keeps order and filters hidden', () => {
    const order: HoverField[] = ['title', 'chips', 'staff'];
    expect(visibleHoverFields(order, new Set(['chips']))).toEqual(['title', 'staff']);
  });
});

describe('moveHoverField', () => {
  const order: HoverField[] = ['title', 'staff', 'client', 'phone'];

  it('drops after the target when dragging down', () => {
    expect(moveHoverField(order, 'title', 'client')).toEqual(['staff', 'client', 'title', 'phone']);
  });

  it('drops before the target when dragging up', () => {
    expect(moveHoverField(order, 'phone', 'staff')).toEqual(['title', 'phone', 'staff', 'client']);
  });

  it('is a no-op for unknown keys or a self-drop', () => {
    expect(moveHoverField(order, 'title', 'title')).toBe(order);
    expect(moveHoverField(order, 'nope', 'staff')).toBe(order);
  });
});
