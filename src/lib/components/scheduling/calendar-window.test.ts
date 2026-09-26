import { describe, expect, it } from 'vitest';
import {
  calendarDays,
  calendarInstantWindow,
  calendarLoadDays,
  calendarLoadWindow,
  monthGridDays,
  parseCalendarDate,
  parseCalendarView,
  shiftCalendarDate,
  shiftCalendarMonth,
} from './calendar-window';

describe('calendar window', () => {
  it('defaults to week, maps the legacy workweek URL value, and rejects junk views', () => {
    expect(parseCalendarView(null)).toBe('week');
    expect(parseCalendarView('bogus')).toBe('week');
    expect(parseCalendarView('day')).toBe('day');
    expect(parseCalendarView('month')).toBe('month');
    // Pre-2026-09-25 bookmarks/shares carried `?view=workweek` — it must still
    // resolve, onto `week`, not silently fall back to the default.
    expect(parseCalendarView('workweek')).toBe('week');
  });

  it('only honours a real YYYY-MM-DD date', () => {
    expect(parseCalendarDate('2026-09-14', '2026-01-01')).toBe('2026-09-14');
    expect(parseCalendarDate('yesterday', '2026-01-01')).toBe('2026-01-01');
  });

  it('anchors the week view on Monday, from any day of that week', () => {
    // 2026-09-14 is a Monday; 2026-09-20 the Sunday that closes the same week.
    expect(calendarDays('2026-09-14', 'week')).toEqual([
      '2026-09-14',
      '2026-09-15',
      '2026-09-16',
      '2026-09-17',
      '2026-09-18',
      '2026-09-19',
      '2026-09-20',
    ]);
    expect(calendarDays('2026-09-20', 'week')[0]).toBe('2026-09-14');
    expect(calendarDays('2026-09-20', 'week')).toHaveLength(7);
    expect(calendarDays('2026-09-20', 'week').at(-1)).toBe('2026-09-20');
    expect(calendarDays('2026-09-16', 'day')).toEqual(['2026-09-16']);
  });

  it('renders the 42-cell month grid for the month view', () => {
    expect(calendarDays('2026-09-14', 'month')).toEqual(monthGridDays('2026-09-14'));
    expect(calendarDays('2026-09-14', 'month')).toHaveLength(42);
  });

  it('steps one day in day view, one week in week view, and one month in month view', () => {
    expect(shiftCalendarDate('2026-09-30', 'day', 1)).toBe('2026-10-01');
    expect(shiftCalendarDate('2026-10-01', 'day', -1)).toBe('2026-09-30');
    expect(shiftCalendarDate('2026-09-14', 'week', 1)).toBe('2026-09-21');
    expect(shiftCalendarDate('2026-09-14', 'week', -1)).toBe('2026-09-07');
    expect(shiftCalendarDate('2026-09-14', 'month', 1)).toBe('2026-10-01');
    expect(shiftCalendarDate('2026-01-14', 'month', -1)).toBe('2025-12-01');
  });

  it('covers both endpoint days in the org timezone', () => {
    const { days, from, to } = calendarInstantWindow('2026-09-14', 'week', 'America/Lima');

    expect(days).toHaveLength(7);
    // Lima is UTC-5 year round: Monday 00:00 local is 05:00 UTC.
    expect(from.toISOString()).toBe('2026-09-14T05:00:00.000Z');
    // Endpoint check: the LAST day (Sunday) must be fully inside the window.
    expect(to.getTime()).toBeGreaterThan(Date.parse('2026-09-20T23:59:00-05:00'));
    expect(to.getTime()).toBeLessThan(Date.parse('2026-09-21T00:00:00-05:00'));
  });

  it('returns a single whole day for the day view', () => {
    const { from, to } = calendarInstantWindow('2026-09-14', 'day', 'America/Lima');

    expect(from.toISOString()).toBe('2026-09-14T05:00:00.000Z');
    expect(to.toISOString()).toBe('2026-09-15T04:59:59.999Z');
  });

  it('steps the date picker a whole month, rolling the year over', () => {
    expect(shiftCalendarMonth('2026-09-14', 1)).toBe('2026-10-01');
    expect(shiftCalendarMonth('2026-01-14', -1)).toBe('2025-12-01');
    expect(shiftCalendarMonth('2026-12-05', 1)).toBe('2027-01-01');
  });

  it('builds a Monday-first 42-cell month grid with adjacent-month spillover', () => {
    // September 2026 opens on a Tuesday and closes on a Wednesday.
    const grid = monthGridDays('2026-09-14');
    expect(grid).toHaveLength(42);
    expect(grid[0]).toBe('2026-08-31'); // Monday before the 1st
    expect(grid[1]).toBe('2026-09-01');
    expect(grid.at(-1)).toBe('2026-10-11'); // fills the last row past the 30th
  });

  it('load range is just the one day in day view (unaffected by infinite scroll)', () => {
    expect(calendarLoadDays('2026-09-16', 'day')).toEqual(['2026-09-16']);
  });

  it('load range is 4 ISO weeks anchored one week behind the focused date for week view', () => {
    // 2026-09-14 is a Monday (week W). W-1 starts 2026-09-07, W+2 ends 2026-09-27.
    const days = calendarLoadDays('2026-09-14', 'week');
    expect(days).toHaveLength(28);
    expect(days[0]).toBe('2026-09-07');
    expect(days.at(-1)).toBe('2026-10-04');
    // Any day inside week W resolves to the SAME anchored range.
    expect(calendarLoadDays('2026-09-18', 'week')).toEqual(days);
  });

  it('load range is the month grid plus one padding week on each side for month view', () => {
    // September 2026's grid runs 2026-08-31 .. 2026-10-11 (42 days); padded by
    // a week each side that becomes 2026-08-24 .. 2026-10-18 (56 days = 8 rows).
    const days = calendarLoadDays('2026-09-14', 'month');
    expect(days).toHaveLength(56);
    expect(days[0]).toBe('2026-08-24');
    expect(days.at(-1)).toBe('2026-10-18');
  });

  it('resolves the wider load range to an instant window inclusive of the last day', () => {
    const { days, from, to } = calendarLoadWindow('2026-09-14', 'week', 'America/Lima');

    expect(days).toHaveLength(28);
    expect(days[0]).toBe('2026-09-07');
    // Lima is UTC-5 year round: Monday 00:00 local is 05:00 UTC.
    expect(from.toISOString()).toBe('2026-09-07T05:00:00.000Z');
    // Endpoint check: the LAST day must be fully inside the window.
    expect(to.getTime()).toBeGreaterThan(Date.parse('2026-10-04T23:59:00-05:00'));
    expect(to.getTime()).toBeLessThan(Date.parse('2026-10-05T00:00:00-05:00'));
  });

  it('day view load window matches calendarInstantWindow exactly', () => {
    const load = calendarLoadWindow('2026-09-14', 'day', 'America/Lima');
    const instant = calendarInstantWindow('2026-09-14', 'day', 'America/Lima');
    expect(load).toEqual(instant);
  });
});
