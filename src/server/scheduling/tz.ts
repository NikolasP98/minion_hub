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

const PARTS_FMT_CACHE = new Map<string, Intl.DateTimeFormat>();

function partsFormatter(timeZone: string): Intl.DateTimeFormat {
  let fmt = PARTS_FMT_CACHE.get(timeZone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    PARTS_FMT_CACHE.set(timeZone, fmt);
  }
  return fmt;
}

export interface ZonedParts {
  year: number;
  month: number; // 1-12
  day: number; // 1-31
  hour: number; // 0-23
  minute: number;
  second: number;
}

/** The wall-clock parts of `instant` as observed in `timeZone`. */
export function utcToZonedParts(instant: Date, timeZone: string): ZonedParts {
  const parts = partsFormatter(timeZone).formatToParts(instant);
  const map: Record<string, string> = {};
  for (const p of parts) if (p.type !== 'literal') map[p.type] = p.value;
  // Intl emits hour '24' for midnight in some engines; normalize to 0.
  const hour = map.hour === '24' ? 0 : Number(map.hour);
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour,
    minute: Number(map.minute),
    second: Number(map.second),
  };
}

/** Offset of `timeZone` from UTC at `instant`, in minutes (e.g. -300 for Lima). */
export function tzOffsetMinutes(instant: Date, timeZone: string): number {
  const p = utcToZonedParts(instant, timeZone);
  const asUTC = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  // Round to the second to absorb sub-second formatToParts jitter.
  return Math.round((asUTC - instant.getTime()) / 60000);
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
  const p = utcToZonedParts(instant, timeZone);
  const mm = String(p.month).padStart(2, '0');
  const dd = String(p.day).padStart(2, '0');
  return `${p.year}-${mm}-${dd}`;
}
