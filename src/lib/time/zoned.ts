/**
 * Client-safe IANA timezone and ISO calendar-key primitives.
 *
 * Instants and calendar keys are deliberately separate here. A `Date` is an
 * absolute instant; `YYYY-MM-DD` is a wall-calendar key. The latter only uses
 * UTC fields as a timezone-free carrier for Gregorian arithmetic.
 */

export interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

export interface WallTimeInput {
  date: string;
  hour: number;
  minute: number;
  second?: number;
  millisecond?: number;
}

export interface WallTimeCandidate {
  instant: Date;
  offsetMinutes: number;
}

export type WallTimeResolution =
  | {
      ok: true;
      kind: 'exact' | 'ambiguous';
      instant: Date;
      offsetMinutes: number;
      candidates: WallTimeCandidate[];
    }
  | { ok: false; kind: 'nonexistent' | 'invalid'; reason: string };

export type ZonedDateBoundary =
  { ok: true; instant: Date } | { ok: false; kind: 'nonexistent' | 'invalid'; reason: string };

export type ZonedDayWindowResult =
  | { ok: true; from: Date | null; to: Date | null }
  | { ok: false; kind: 'nonexistent' | 'invalid'; reason: string };

/** A tenant-controlled timezone must not grow a process-global cache forever. */
export const ZONED_FORMATTER_CACHE_LIMIT = 32;
const PARTS_FORMATTERS = new Map<string, Intl.DateTimeFormat>();

function boundedSet<K, V>(map: Map<K, V>, key: K, value: V, limit: number): void {
  if (map.has(key)) map.delete(key);
  while (map.size >= limit) {
    const oldest = map.keys().next().value as K | undefined;
    if (oldest === undefined) break;
    map.delete(oldest);
  }
  map.set(key, value);
}

function partsFormatter(timeZone: string): Intl.DateTimeFormat {
  const cached = PARTS_FORMATTERS.get(timeZone);
  if (cached) {
    PARTS_FORMATTERS.delete(timeZone);
    PARTS_FORMATTERS.set(timeZone, cached);
    return cached;
  }
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  boundedSet(PARTS_FORMATTERS, timeZone, formatter, ZONED_FORMATTER_CACHE_LIMIT);
  return formatter;
}

/** Test receipt for the bounded cache contract; not used by product code. */
export function zonedFormatterCacheSizeForTests(): number {
  return PARTS_FORMATTERS.size;
}

/** The wall-clock parts of `instant` as observed in `timeZone`. */
export function instantParts(instant: Date, timeZone: string): ZonedParts {
  if (Number.isNaN(instant.getTime())) throw new RangeError('invalid instant');
  const parts = partsFormatter(timeZone).formatToParts(instant);
  const map: Record<string, string> = {};
  for (const part of parts) if (part.type !== 'literal') map[part.type] = part.value;
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

/** Offset of `timeZone` from UTC at `instant`, in minutes. */
export function offsetMinutesAt(instant: Date, timeZone: string): number {
  const p = instantParts(instant, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asUtc - instant.getTime()) / 60_000);
}

const pad2 = (value: number) => String(value).padStart(2, '0');

/** `YYYY-MM-DD` for the calendar date of `instant` in `timeZone`. */
export function instantDateKey(instant: Date, timeZone: string): string {
  const p = instantParts(instant, timeZone);
  return `${p.year}-${pad2(p.month)}-${pad2(p.day)}`;
}

export interface DateKeyParts {
  year: number;
  month: number;
  day: number;
}

/** Strict Gregorian `YYYY-MM-DD` parser. */
export function parseDateKey(value: string): DateKeyParts | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const carrier = new Date(Date.UTC(year, month - 1, day));
  if (
    carrier.getUTCFullYear() !== year ||
    carrier.getUTCMonth() !== month - 1 ||
    carrier.getUTCDate() !== day
  )
    return null;
  return { year, month, day };
}

export function dateKeyFromParts(parts: DateKeyParts): string | null {
  const key = `${String(parts.year).padStart(4, '0')}-${pad2(parts.month)}-${pad2(parts.day)}`;
  return parseDateKey(key) ? key : null;
}

function dateKeyCarrier(value: string): Date | null {
  const p = parseDateKey(value);
  return p ? new Date(Date.UTC(p.year, p.month - 1, p.day)) : null;
}

export function dateKeyAddDays(value: string, days: number): string | null {
  const carrier = dateKeyCarrier(value);
  if (!carrier || !Number.isInteger(days)) return null;
  carrier.setUTCDate(carrier.getUTCDate() + days);
  return `${carrier.getUTCFullYear()}-${pad2(carrier.getUTCMonth() + 1)}-${pad2(carrier.getUTCDate())}`;
}

export function dateKeyWeekday(value: string): number | null {
  return dateKeyCarrier(value)?.getUTCDay() ?? null;
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Month shift with end-of-month clamping (Mar 31 - 1 month => Feb 28/29). */
export function dateKeyAddMonths(value: string, months: number): string | null {
  const p = parseDateKey(value);
  if (!p || !Number.isInteger(months)) return null;
  const monthIndex = p.year * 12 + (p.month - 1) + months;
  const year = Math.floor(monthIndex / 12);
  const month = (((monthIndex % 12) + 12) % 12) + 1;
  const day = Math.min(p.day, daysInMonth(year, month));
  return dateKeyFromParts({ year, month, day });
}

/** Year shift with leap-day clamping (Feb 29 - 1 year => Feb 28). */
export function dateKeyAddYears(value: string, years: number): string | null {
  const p = parseDateKey(value);
  if (!p || !Number.isInteger(years)) return null;
  const year = p.year + years;
  const day = Math.min(p.day, daysInMonth(year, p.month));
  return dateKeyFromParts({ year, month: p.month, day });
}

function validWallInput(input: WallTimeInput): boolean {
  return (
    parseDateKey(input.date) !== null &&
    Number.isInteger(input.hour) &&
    input.hour >= 0 &&
    input.hour <= 23 &&
    Number.isInteger(input.minute) &&
    input.minute >= 0 &&
    input.minute <= 59 &&
    Number.isInteger(input.second ?? 0) &&
    (input.second ?? 0) >= 0 &&
    (input.second ?? 0) <= 59 &&
    Number.isInteger(input.millisecond ?? 0) &&
    (input.millisecond ?? 0) >= 0 &&
    (input.millisecond ?? 0) <= 999
  );
}

function sameWall(candidate: Date, input: WallTimeInput, timeZone: string): boolean {
  const date = parseDateKey(input.date)!;
  const parts = instantParts(candidate, timeZone);
  return (
    parts.year === date.year &&
    parts.month === date.month &&
    parts.day === date.day &&
    parts.hour === input.hour &&
    parts.minute === input.minute &&
    parts.second === (input.second ?? 0) &&
    candidate.getUTCMilliseconds() === (input.millisecond ?? 0)
  );
}

/**
 * Enumerate every instant matching a wall time. The search is fixed at seventeen
 * offset samples across ±48 hours, then every candidate is round-tripped. This
 * covers date-line changes and non-hour DST without unbounded probing.
 */
export function wallTimeCandidates(
  input: WallTimeInput,
  timeZone: string,
): WallTimeCandidate[] | null {
  if (!validWallInput(input)) return null;
  const date = parseDateKey(input.date)!;
  const wallAsUtc = Date.UTC(
    date.year,
    date.month - 1,
    date.day,
    input.hour,
    input.minute,
    input.second ?? 0,
    input.millisecond ?? 0,
  );
  const offsets = new Set<number>();
  try {
    for (let hours = -48; hours <= 48; hours += 6) {
      offsets.add(offsetMinutesAt(new Date(wallAsUtc + hours * 3_600_000), timeZone));
    }
  } catch {
    return null;
  }
  const candidates: WallTimeCandidate[] = [];
  for (const offsetMinutes of offsets) {
    const instant = new Date(wallAsUtc - offsetMinutes * 60_000);
    if (sameWall(instant, input, timeZone)) candidates.push({ instant, offsetMinutes });
  }
  candidates.sort((a, b) => a.instant.getTime() - b.instant.getTime());
  return candidates;
}

export function resolveWallTime(
  input: WallTimeInput,
  timeZone: string,
  opts: { preferredOffsetMinutes?: number } = {},
): WallTimeResolution {
  const candidates = wallTimeCandidates(input, timeZone);
  if (candidates === null)
    return { ok: false, kind: 'invalid', reason: 'invalid wall time or timezone' };
  if (candidates.length === 0)
    return { ok: false, kind: 'nonexistent', reason: 'wall time does not exist in timezone' };
  const preferred =
    opts.preferredOffsetMinutes === undefined
      ? undefined
      : candidates.find((candidate) => candidate.offsetMinutes === opts.preferredOffsetMinutes);
  const selected = preferred ?? candidates[0];
  return {
    ok: true,
    kind: candidates.length === 1 ? 'exact' : 'ambiguous',
    instant: selected.instant,
    offsetMinutes: selected.offsetMinutes,
    candidates,
  };
}

/**
 * Earliest instant belonging to a local date. Binary search is bounded to a
 * six-day horizon and returns nonexistent for a wholly skipped date.
 */
export function startOfZonedDate(date: string, timeZone: string): ZonedDateBoundary {
  const p = parseDateKey(date);
  if (!p) return { ok: false, kind: 'invalid', reason: 'invalid date key' };
  const nominalNoon = Date.UTC(p.year, p.month - 1, p.day, 12);
  let low = nominalNoon - 72 * 3_600_000;
  let high = nominalNoon + 72 * 3_600_000;
  try {
    // First instant whose projected date is >= the requested date.
    while (low < high) {
      const mid = low + Math.floor((high - low) / 2);
      if (instantDateKey(new Date(mid), timeZone) < date) low = mid + 1;
      else high = mid;
    }
    if (instantDateKey(new Date(low), timeZone) !== date) {
      return { ok: false, kind: 'nonexistent', reason: 'local date does not exist in timezone' };
    }
    return { ok: true, instant: new Date(low) };
  } catch {
    return { ok: false, kind: 'invalid', reason: 'invalid timezone' };
  }
}

/** Inclusive local date range represented as a half-open instant window. */
export function checkedZonedDayWindow(
  from: string,
  to: string,
  timeZone: string,
): ZonedDayWindowResult {
  const start = from ? startOfZonedDate(from, timeZone) : null;
  if (start && !start.ok) return start;
  const next = to ? dateKeyAddDays(to, 1) : null;
  if (to && !next) return { ok: false, kind: 'invalid', reason: 'invalid upper date key' };
  const end = next ? startOfZonedDate(next, timeZone) : null;
  if (end && !end.ok) return end;
  return {
    ok: true,
    from: start?.instant ?? null,
    to: end?.instant ?? null,
  };
}
