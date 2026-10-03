/**
 * Dependency-free IANA timezone math via `Intl.DateTimeFormat`. The scheduling
 * engine works with wall-clock availability ('HH:MM' on a date in a resource's
 * timezone) and must turn it into absolute UTC instants and back — correctly
 * across DST boundaries — without pulling in luxon/date-fns-tz.
 *
 * The trick (the standard Intl approach): formatting a UTC instant in a target
 * timezone yields that zone's wall-clock parts; the gap between those parts
 * (re-read as if UTC) and the original instant IS the zone's offset at that
 * instant. Converting a wall time to UTC is then a fixed-point: guess, measure
 * the offset, correct, and re-measure once to settle DST transitions.
 */

import {
  instantDateKey,
  instantParts,
  offsetMinutesAt,
  type ZonedParts,
} from '$lib/time/zoned';

export type { ZonedParts } from '$lib/time/zoned';

/** The wall-clock parts of `instant` as observed in `timeZone`. */
export function utcToZonedParts(instant: Date, timeZone: string): ZonedParts {
  return instantParts(instant, timeZone);
}

/** Offset of `timeZone` from UTC at `instant`, in minutes (e.g. -300 for Lima). */
export function tzOffsetMinutes(instant: Date, timeZone: string): number {
  return offsetMinutesAt(instant, timeZone);
}

/**
 * Convert a wall-clock time in `timeZone` to the absolute UTC instant.
 * `month` is 1-12. Resolves DST gaps/overlaps with a two-pass fixed point.
 */
export function zonedTimeToUtc(
  timeZone: string,
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second = 0,
): Date {
  const wallAsUtcMs = Date.UTC(year, month - 1, day, hour, minute, second);
  // First guess: treat the wall time as UTC, then shift by the offset measured
  // at that guess. One correction pass settles all but the rarest DST edges, so
  // we measure again at the corrected instant and use that offset.
  const offset1 = tzOffsetMinutes(new Date(wallAsUtcMs), timeZone);
  const guess = new Date(wallAsUtcMs - offset1 * 60000);
  const offset2 = tzOffsetMinutes(guess, timeZone);
  if (offset2 === offset1) return guess;
  return new Date(wallAsUtcMs - offset2 * 60000);
}

/** Parse 'HH:MM' (or 'HH:MM:SS') into minutes-since-midnight. */
export function parseHmToMinutes(hm: string): number {
  const [h, m] = hm.split(':');
  return Number(h) * 60 + Number(m);
}

/** 'YYYY-MM-DD' → {year, month, day} (month 1-12). */
export function parseDateKey(dateKey: string): { year: number; month: number; day: number } {
  const [y, m, d] = dateKey.split('-').map(Number);
  return { year: y, month: m, day: d };
}

/** The day-of-week (0=Sun..6=Sat) of a calendar date. Weekday is tz-independent. */
export function dateKeyDayOfWeek(dateKey: string): number {
  const { year, month, day } = parseDateKey(dateKey);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

/** 'YYYY-MM-DD' date key for the calendar date of `instant` in `timeZone`. */
export function zonedDateKey(instant: Date, timeZone: string): string {
  return instantDateKey(instant, timeZone);
}

/**
 * ISO 8601 with an explicit `±HH:MM` offset — the wall clock of `instant` in
 * `timeZone`, followed by that zone's offset AT that instant (so DST is handled
 * per event, not per payload).
 *
 * This is a lossless wire value, not the renderer's wall-time projection. The
 * client projects it to the viewer's local calendar independently of the
 * resource timezone and the browser's current DST offset.
 */
export function toOffsetIsoString(instant: Date, timeZone: string): string {
  const p = utcToZonedParts(instant, timeZone);
  const offset = tzOffsetMinutes(instant, timeZone);
  const sign = offset < 0 ? '-' : '+';
  const abs = Math.abs(offset);
  const pad = (n: number) => String(n).padStart(2, '0');
  const fraction = instant.getMilliseconds()
    ? `.${String(instant.getMilliseconds()).padStart(3, '0')}`
    : '';
  return (
    `${p.year}-${pad(p.month)}-${pad(p.day)}` +
    `T${pad(p.hour)}:${pad(p.minute)}:${pad(p.second)}${fraction}` +
    `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
  );
}
