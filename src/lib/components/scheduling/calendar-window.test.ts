import { describe, expect, it } from 'vitest';
import {
  calendarDays,
  calendarInstantWindow,
  parseCalendarDate,
  parseCalendarView,
  shiftCalendarDate,
} from './calendar-window';

describe('calendar window', () => {
  it('defaults to the workweek and rejects junk views', () => {
    expect(parseCalendarView(null)).toBe('workweek');
    expect(parseCalendarView('month')).toBe('workweek');
    expect(parseCalendarView('day')).toBe('day');
  });

  it('only honours a real YYYY-MM-DD date', () => {
    expect(parseCalendarDate('2026-09-14', '2026-01-01')).toBe('2026-09-14');
    expect(parseCalendarDate('yesterday', '2026-01-01')).toBe('2026-01-01');
  });

  it('anchors both week views on Monday, from any day of that week', () => {
    // 2026-09-14 is a Monday; 2026-09-20 the Sunday that closes the same week.
    expect(calendarDays('2026-09-14', 'workweek')).toEqual([
      '2026-09-14',
      '2026-09-15',
      '2026-09-16',
      '2026-09-17',
      '2026-09-18',
    ]);
    expect(calendarDays('2026-09-20', 'workweek')[0]).toBe('2026-09-14');
    expect(calendarDays('2026-09-20', 'week')).toHaveLength(7);
    expect(calendarDays('2026-09-20', 'week').at(-1)).toBe('2026-09-20');
    expect(calendarDays('2026-09-16', 'day')).toEqual(['2026-09-16']);
  });

  it('steps one day in day view and one week otherwise, across month ends', () => {
    expect(shiftCalendarDate('2026-09-30', 'day', 1)).toBe('2026-10-01');
    expect(shiftCalendarDate('2026-10-01', 'day', -1)).toBe('2026-09-30');
    expect(shiftCalendarDate('2026-09-14', 'workweek', 1)).toBe('2026-09-21');
    expect(shiftCalendarDate('2026-09-14', 'week', -1)).toBe('2026-09-07');
  });

  it('covers both endpoint days in the org timezone', () => {
    const { days, from, to } = calendarInstantWindow('2026-09-14', 'workweek', 'America/Lima');

    expect(days).toHaveLength(5);
    // Lima is UTC-5 year round: Monday 00:00 local is 05:00 UTC.
    expect(from.toISOString()).toBe('2026-09-14T05:00:00.000Z');
    // Endpoint check: the LAST day (Friday) must be fully inside the window.
    expect(to.getTime()).toBeGreaterThan(Date.parse('2026-09-18T23:59:00-05:00'));
    expect(to.getTime()).toBeLessThan(Date.parse('2026-09-19T00:00:00-05:00'));
  });

  it('returns a single whole day for the day view', () => {
    const { from, to } = calendarInstantWindow('2026-09-14', 'day', 'America/Lima');

    expect(from.toISOString()).toBe('2026-09-14T05:00:00.000Z');
    expect(to.toISOString()).toBe('2026-09-15T04:59:59.999Z');
  });
});
