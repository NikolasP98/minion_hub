import { describe, expect, it } from 'vitest';
import { dayAt, dayIndex, mondayOf, renderedRange } from './runway';

describe('runway day math', () => {
  it('anchors any day on its ISO Monday', () => {
    // 2026-09-14 is a Monday, 2026-09-20 the Sunday closing the same week.
    expect(mondayOf('2026-09-14')).toBe('2026-09-14');
    expect(mondayOf('2026-09-18')).toBe('2026-09-14');
    expect(mondayOf('2026-09-20')).toBe('2026-09-14');
    expect(mondayOf('2026-09-21')).toBe('2026-09-21');
  });

  it('maps index ↔ day both ways, across month and year ends', () => {
    const start = '2026-01-05';
    expect(dayIndex(start, '2026-01-05')).toBe(0);
    expect(dayIndex(start, '2026-02-04')).toBe(30);
    expect(dayIndex(start, '2026-01-01')).toBe(-4);
    expect(dayAt(start, 0)).toBe('2026-01-05');
    expect(dayAt(start, 30)).toBe('2026-02-04');
    expect(dayAt(start, -5)).toBe('2025-12-31');
    // Round trip over a leap day (2028-02-29 exists).
    expect(dayAt(start, dayIndex(start, '2028-03-01'))).toBe('2028-03-01');
  });

  it('is DST-proof: a runway crossing a clock change keeps one index per day', () => {
    // Lima has no DST, but the math must hold for orgs that do — UTC-based day
    // arithmetic never produces a 23/25-hour day.
    const start = '2026-03-01';
    expect(dayIndex(start, '2026-04-01')).toBe(31);
    expect(dayAt(start, 31)).toBe('2026-04-01');
  });
});

describe('renderedRange', () => {
  const TOTAL = 105 * 7;

  it('pads the visible window on both sides and clamps to the runway', () => {
    expect(renderedRange(0, 100, 5, TOTAL)).toEqual({ first: 0, last: 11 });
    expect(renderedRange(3640, 100, 5, TOTAL)).toEqual({ first: 29, last: 47 });
    // Last column of the runway: the upper edge clamps, the lower one does not.
    expect(renderedRange((TOTAL - 5) * 100, 100, 5, TOTAL)).toEqual({
      first: TOTAL - 12,
      last: TOTAL - 1,
    });
  });

  it('uses the FIRST partially visible column, so a mid-column scroll still renders it', () => {
    expect(renderedRange(150, 100, 5, TOTAL, 1)).toEqual({ first: 0, last: 6 });
    expect(renderedRange(250, 100, 5, TOTAL, 1)).toEqual({ first: 1, last: 7 });
  });

  it('falls back to exactly the view window before the first measurement', () => {
    // colW is 0 until the ResizeObserver fires (and during SSR): the grid must
    // still render the view's own columns rather than nothing.
    expect(renderedRange(0, 0, 7, TOTAL)).toEqual({ first: 0, last: 6 });
  });
});
