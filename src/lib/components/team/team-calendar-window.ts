import { checkedZonedDayWindow, dateKeyAddDays, instantDateKey } from '$lib/time/zoned';

export interface TeamCalendarWindow {
  today: string;
  yearStart: string;
  yearEnd: string;
  weekStart: string;
  /** Inclusive instant bounds for `listBookings`, whose upper predicate is `<=`. */
  from: Date;
  to: Date;
}

/**
 * Resolve the Team page's date-only HR year and seven-day booking strip from
 * the scheduling organization's calendar. HR dates stay plain date keys; only
 * the booking read crosses into absolute instants.
 */
export function teamCalendarWindow(timeZone: string, now: Date = new Date()): TeamCalendarWindow {
  const today = instantDateKey(now, timeZone);
  const weekStart = dateKeyAddDays(today, -3);
  const weekEnd = dateKeyAddDays(today, 3);
  if (!weekStart || !weekEnd) throw new RangeError('invalid Team calendar date');

  const window = checkedZonedDayWindow(weekStart, weekEnd, timeZone);
  if (!window.ok || !window.from || !window.to) {
    throw new RangeError(window.ok ? 'invalid Team calendar window' : window.reason);
  }

  const year = today.slice(0, 4);
  return {
    today,
    yearStart: `${year}-01-01`,
    yearEnd: `${year}-12-31`,
    weekStart,
    from: window.from,
    to: new Date(window.to.getTime() - 1),
  };
}
