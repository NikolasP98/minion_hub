import type { CalendarView } from './TimeOffCalendar.svelte';

const VIEWS = new Set<CalendarView>(['month', 'week', 'agenda']);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Parses the time-off calendar's `?date=`/`?cal=` URL params, falling back
 *  per-field to the caller's default when absent or malformed — a bookmarked
 *  or hand-edited link with only one of the two still restores cleanly. */
export function parseTimeOffParams(
  search: URLSearchParams,
  fallbackDate: string,
  fallbackView: CalendarView,
): { date: string; view: CalendarView } {
  const date = search.get('date');
  const cal = search.get('cal');
  return {
    date: date && DATE_RE.test(date) ? date : fallbackDate,
    view: VIEWS.has(cal as CalendarView) ? (cal as CalendarView) : fallbackView,
  };
}
