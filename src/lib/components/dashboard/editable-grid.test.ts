import { describe, it, expect } from 'vitest';
import { clampSpan, reorder, mergeLayout } from './editable-grid';

describe('editable-grid helpers', () => {
  it('clamps spans into [1, cols] × [1, maxRows] and rounds', () => {
    expect(clampSpan({ w: 0, h: 0 }, 4)).toEqual({ w: 1, h: 1 });
    expect(clampSpan({ w: 9, h: 99 }, 4)).toEqual({ w: 4, h: 8 });
    expect(clampSpan({ w: 2.6, h: 1.4 }, 4)).toEqual({ w: 3, h: 1 });
  });

  it('reorders an id before a target, or to the end', () => {
    expect(reorder(['a', 'b', 'c'], 'c', 'a')).toEqual(['c', 'a', 'b']);
    expect(reorder(['a', 'b', 'c'], 'a', null)).toEqual(['b', 'c', 'a']);
    expect(reorder(['a', 'b', 'c'], 'a', 'a')).toEqual(['b', 'c', 'a']);
    expect(reorder(['a', 'b', 'c'], 'b', 'missing')).toEqual(['a', 'c', 'b']);
  });

  it('merges saved layout over defaults: keeps order, appends new, drops stale', () => {
    const defaults = [
      { id: 'a', w: 1, h: 1 },
      { id: 'b', w: 2, h: 2 },
      { id: 'c', w: 4, h: 1 }, // new card not in saved
    ];
    const saved = { order: ['gone', 'b', 'a'], span: { b: { w: 3, h: 3 } } };
    const merged = mergeLayout(defaults, saved, 4);
    expect(merged.order).toEqual(['b', 'a', 'c']); // stale 'gone' dropped, new 'c' appended
    expect(merged.span.b).toEqual({ w: 3, h: 3 }); // saved span wins
    expect(merged.span.a).toEqual({ w: 1, h: 1 }); // default span for unsaved
    expect(merged.span.c).toEqual({ w: 4, h: 1 });
  });

  it('falls back to defaults when nothing saved', () => {
    const defaults = [{ id: 'a', w: 2, h: 1 }];
    expect(mergeLayout(defaults, null, 4)).toEqual({ order: ['a'], span: { a: { w: 2, h: 1 } } });
  });
});
