import { error } from '@sveltejs/kit';
import { parseDateKey, instantDateKey } from '$lib/time/zoned';
import { parsePeriod, resolvePeriodWindow, type Period } from '$lib/finance/period';

/** Agent dates are Gregorian calendar days in the business zone. SQL uses
 * [local from midnight, local midnight AFTER to), including DST transitions.
 * Reject explicit invalid input; keep the dashboard parser/default untouched.
 */
export function parseAssistantPeriod(url: URL, timezone: string) {
  const from = url.searchParams.get('from');
  const to = url.searchParams.get('to');
  const range = url.searchParams.get('range');
  const bucket = url.searchParams.get('bucket');
  if (range !== null && range !== 'all') throw error(400, 'range: expected all');
  if (bucket !== null && !['day', 'week', 'month'].includes(bucket))
    throw error(400, 'bucket: expected day, week or month');
  for (const [field, value] of [
    ['from', from],
    ['to', to],
  ]) {
    if (value !== null && !parseDateKey(value))
      throw error(400, `${field}: expected a valid YYYY-MM-DD calendar date`);
  }
  if (range === 'all' && (from !== null || to !== null))
    throw error(400, 'range: all cannot be combined with dates');
  if (from && to && from > to) throw error(400, 'to: must be at or after from');
  let calendar: Period;
  const mode =
    range === 'all' ? 'all' : from !== null || to !== null ? 'explicit-days' : 'rolling-12-months';
  if (mode === 'rolling-12-months') {
    const defaults = parsePeriod(url);
    calendar = {
      ...defaults,
      from: instantDateKey(new Date(defaults.from!), timezone),
      to: instantDateKey(new Date(defaults.to!), timezone),
    };
  } else calendar = { from, to, bucket: (bucket ?? 'month') as Period['bucket'] };
  const period = resolvePeriodWindow(calendar, timezone);
  return {
    period,
    periodSemantics: {
      mode,
      timezone,
      calendarFrom: calendar.from,
      calendarTo: calendar.to,
      lower: 'inclusive',
      upper: 'exclusive',
      dateTo: 'inclusive-local-day',
    },
  };
}
