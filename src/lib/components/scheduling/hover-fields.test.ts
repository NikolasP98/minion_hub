import { describe, expect, it } from 'vitest';
import {
  HOVER_FIELDS,
  HOVER_SUB_FIELDS,
  hoverChildren,
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
    const { order } = mergeHoverFields({ order: ['client', 'client', 'staff'], hidden: [] });
    expect(order.filter((k) => k === 'client')).toHaveLength(1);
  });

  // Nesting migration (owner ask 2026-09-25): `phone` used to be a top-level
  // orderable field and is now a sub-item of `client`, so it is unknown AT TOP
  // LEVEL and drops out of a stored order — while staying legal in `hidden`.
  it('drops a stored top-level `phone` from the order but keeps it hideable', () => {
    const { hidden, order } = mergeHoverFields({
      order: ['client', 'phone', 'staff'],
      hidden: ['phone'],
    });
    expect(order).not.toContain('phone');
    expect(order.slice(0, 2)).toEqual(['client', 'staff']);
    expect([...hidden]).toEqual(['phone']);
  });

  it('appends `notes` for a viewer whose prefs predate it', () => {
    const stored = ['status', 'title', 'staff', 'client', 'phone', 'tags', 'chips', 'actions'];
    const { order } = mergeHoverFields({ order: stored, hidden: [] });
    expect(order).toEqual([...stored.filter((k) => k !== 'phone'), 'notes']);
  });
});

describe('HOVER_FIELD_TREE', () => {
  it('hangs `phone` under `client` and nowhere else', () => {
    expect(hoverChildren('client')).toEqual(['phone']);
    expect(HOVER_SUB_FIELDS).toEqual(['phone']);
    expect(HOVER_FIELDS).not.toContain('phone');
    expect(HOVER_FIELDS.filter((k) => hoverChildren(k).length > 0)).toEqual(['client']);
  });

  it('has no sub-items for a leaf field', () => {
    expect(hoverChildren('tags')).toEqual([]);
    expect(hoverChildren('nope')).toEqual([]);
  });

  it('renders no sub-item once its parent is hidden', () => {
    // The card only reaches a sub-item from inside its parent's branch, so the
    // parent dropping out of the visible rows takes the sub-item with it.
    const { hidden, order } = mergeHoverFields({ order: [], hidden: ['client'] });
    expect(visibleHoverFields(order, hidden)).not.toContain('client');
    expect(hidden.has('phone')).toBe(false); // still enabled, just unreachable
  });
});

describe('visibleHoverFields', () => {
  it('keeps order and filters hidden', () => {
    const order: HoverField[] = ['title', 'chips', 'staff'];
    expect(visibleHoverFields(order, new Set(['chips']))).toEqual(['title', 'staff']);
  });
});

describe('moveHoverField', () => {
  const order: HoverField[] = ['title', 'staff', 'client', 'notes'];

  it('drops after the target when dragging down', () => {
    expect(moveHoverField(order, 'title', 'client')).toEqual(['staff', 'client', 'title', 'notes']);
  });

  it('drops before the target when dragging up', () => {
    expect(moveHoverField(order, 'notes', 'staff')).toEqual(['title', 'notes', 'staff', 'client']);
  });

  it('is a no-op for unknown keys or a self-drop', () => {
    expect(moveHoverField(order, 'title', 'title')).toBe(order);
    expect(moveHoverField(order, 'nope', 'staff')).toBe(order);
  });
});
