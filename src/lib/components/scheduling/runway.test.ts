import { describe, expect, it } from 'vitest';
import { dayAt, dayIndex, majorityMonth, mondayOf, renderedRange, rowAt, rowIndex } from './runway';

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

describe('month runway rows', () => {
  it('maps row index ↔ Monday both ways, from any day of the week', () => {
    // 2026-09-14 is a Monday; 2026-09-20 the Sunday closing the same week.
    const start = '2026-09-14';
    expect(rowIndex(start, '2026-09-14')).toBe(0);
    expect(rowIndex(start, '2026-09-20')).toBe(0);
    expect(rowIndex(start, '2026-09-21')).toBe(1);
    expect(rowIndex(start, '2026-09-13')).toBe(-1);
    expect(rowAt(start, 0)).toBe('2026-09-14');
    expect(rowAt(start, 2)).toBe('2026-09-28');
    expect(rowAt(start, -1)).toBe('2026-09-07');
    // A non-Monday anchor is normalised, so the runway origin can be any day.
    expect(rowAt('2026-09-17', 1)).toBe('2026-09-21');
    expect(rowIndex('2026-09-17', '2026-09-21')).toBe(1);
    // Round trip a year out, over a leap day.
    expect(rowAt(start, rowIndex(start, '2028-03-01'))).toBe(mondayOf('2028-03-01'));
  });

  it('labels a window by the month owning most of its days, not its first row', () => {
    // Aug 31 – Sep 6 leads, but four September rows follow it.
    expect(
      majorityMonth(['2026-08-31', '2026-09-07', '2026-09-14', '2026-09-21', '2026-09-28']),
    ).toBe('2026-09');
    // A single straddling row is decided by the count: Aug 31 – Sep 6 is one
    // August day against six September ones.
    expect(majorityMonth(['2026-08-31'])).toBe('2026-09');
    // Year end: Dec 28 – Jan 3 is 4 December days vs 3 January ones.
    expect(majorityMonth(['2026-12-28'])).toBe('2026-12');
    expect(majorityMonth(['2026-12-28', '2027-01-04'])).toBe('2027-01');
    expect(majorityMonth([])).toBe('');
  });

  it('reuses renderedRange for rows: scrollTop/rowH, padded and clamped', () => {
    const ROWS = 105;
    expect(renderedRange(0, 120, 5, ROWS, 4)).toEqual({ first: 0, last: 8 });
    expect(renderedRange(120 * 10, 120, 5, ROWS, 4)).toEqual({ first: 6, last: 18 });
    expect(renderedRange(120 * (ROWS - 5), 120, 5, ROWS, 4)).toEqual({
      first: ROWS - 9,
      last: ROWS - 1,
    });
  });
});
