import { describe, it, expect } from 'vitest';
import {
  toOffsetIsoString,
  utcToZonedParts,
  tzOffsetMinutes,
  zonedTimeToUtc,
  parseHmToMinutes,
  dateKeyDayOfWeek,
  zonedDateKey,
} from './tz';

describe('tz helpers', () => {
  it('Lima is UTC-5 year-round (no DST)', () => {
    expect(tzOffsetMinutes(new Date('2026-06-20T12:00:00Z'), 'America/Lima')).toBe(-300);
    expect(tzOffsetMinutes(new Date('2026-12-20T12:00:00Z'), 'America/Lima')).toBe(-300);
  });

  it('zonedTimeToUtc maps Lima wall time to the right UTC instant', () => {
    // 2026-06-20 09:00 in Lima (UTC-5) == 14:00 UTC.
    const utc = zonedTimeToUtc('America/Lima', 2026, 6, 20, 9, 0);
    expect(utc.toISOString()).toBe('2026-06-20T14:00:00.000Z');
  });

  it('round-trips wall time → UTC → wall parts', () => {
    const utc = zonedTimeToUtc('America/Lima', 2026, 6, 20, 9, 30);
    const parts = utcToZonedParts(utc, 'America/Lima');
    expect(parts).toMatchObject({ year: 2026, month: 6, day: 20, hour: 9, minute: 30 });
  });

  it('handles a DST zone (New York) on both sides of the spring transition', () => {
    // EST = UTC-5, EDT = UTC-4. 2026 US DST starts Sun Mar 8.
    expect(tzOffsetMinutes(new Date('2026-01-15T12:00:00Z'), 'America/New_York')).toBe(-300);
    expect(tzOffsetMinutes(new Date('2026-07-15T12:00:00Z'), 'America/New_York')).toBe(-240);
    // 09:00 EDT (summer) == 13:00 UTC.
    expect(zonedTimeToUtc('America/New_York', 2026, 7, 15, 9, 0).toISOString()).toBe(
      '2026-07-15T13:00:00.000Z',
    );
    // 09:00 EST (winter) == 14:00 UTC.
    expect(zonedTimeToUtc('America/New_York', 2026, 1, 15, 9, 0).toISOString()).toBe(
      '2026-01-15T14:00:00.000Z',
    );
  });

  it('parseHmToMinutes parses HH:MM', () => {
    expect(parseHmToMinutes('00:00')).toBe(0);
    expect(parseHmToMinutes('09:30')).toBe(570);
    expect(parseHmToMinutes('23:59')).toBe(1439);
  });

  it('dateKeyDayOfWeek matches the calendar weekday', () => {
    expect(dateKeyDayOfWeek('2026-06-20')).toBe(6); // Saturday
    expect(dateKeyDayOfWeek('2026-06-21')).toBe(0); // Sunday
    expect(dateKeyDayOfWeek('2026-06-22')).toBe(1); // Monday
  });

  it('zonedDateKey returns the local calendar date', () => {
    // 03:00 UTC on Jun 20 is still Jun 19 22:00 in Lima.
    expect(zonedDateKey(new Date('2026-06-20T03:00:00Z'), 'America/Lima')).toBe('2026-06-19');
    expect(zonedDateKey(new Date('2026-06-20T14:00:00Z'), 'America/Lima')).toBe('2026-06-20');
  });
});

/**
 * `toOffsetIsoString` is the calendar payload's serializer. `@event-calendar/core`
 * reads an event date's offset with this exact regex — a `Z` suffix does not match,
 * so the library skips its offset correction and draws the raw UTC digits, which is
 * how an 08:00 Lima booking ended up on the 13:00 row.
 * Source: node_modules/@event-calendar/core/src/lib/date.js `parseOffset`.
 */
const EC_PARSE_OFFSET = /([+-])(\d{2}):(\d{2})$/;
function ecOffsetMinutes(iso: string): number | undefined {
  const parts = iso.match(EC_PARSE_OFFSET);
  return parts ? Number(parts[1] + '1') * (Number(parts[2]) * 60 + Number(parts[3])) : undefined;
}

describe('toOffsetIsoString', () => {
  it('renders an 08:00 Lima booking as 08:00 with a -05:00 offset, not 13:00Z', () => {
    // The booking row as Postgres hands it back: an absolute instant.
    const stored = new Date('2026-09-08T13:00:00.000Z');
    expect(stored.toISOString()).toBe('2026-09-08T13:00:00.000Z'); // what shipped, and mis-rendered
    expect(toOffsetIsoString(stored, 'America/Lima')).toBe('2026-09-08T08:00:00-05:00');
  });

  it('emits an offset the calendar library can actually parse', () => {
    const iso = toOffsetIsoString(new Date('2026-09-08T13:00:00.000Z'), 'America/Lima');
    expect(iso.endsWith('Z')).toBe(false);
    expect(ecOffsetMinutes(iso)).toBe(-300);
    // …which is what a plain toISOString() fails to do — the defect in one line.
    expect(ecOffsetMinutes(new Date('2026-09-08T13:00:00.000Z').toISOString())).toBeUndefined();
  });

  it('round-trips back to the same instant (drag/resize write-back)', () => {
    for (const tz of ['America/Lima', 'America/New_York', 'UTC', 'Asia/Tokyo']) {
      for (const iso of ['2026-01-15T05:30:00.000Z', '2026-07-15T23:45:00.000Z']) {
        const stored = new Date(iso);
        expect(new Date(toOffsetIsoString(stored, tz)).getTime()).toBe(stored.getTime());
      }
    }
  });

  it('uses the offset in force at that instant, so DST zones stay put', () => {
    // Same 14:00 UTC instant, six months apart: 09:00 EST in January, 10:00 EDT in July.
    expect(toOffsetIsoString(new Date('2026-01-15T14:00:00.000Z'), 'America/New_York')).toBe(
      '2026-01-15T09:00:00-05:00',
    );
    expect(toOffsetIsoString(new Date('2026-07-15T14:00:00.000Z'), 'America/New_York')).toBe(
      '2026-07-15T10:00:00-04:00',
    );
  });

  it('signs UTC and half-hour zones correctly', () => {
    expect(toOffsetIsoString(new Date('2026-09-08T13:00:00.000Z'), 'UTC')).toBe(
      '2026-09-08T13:00:00+00:00',
    );
    // Kolkata is +05:30 — the minutes half of the offset must survive.
    expect(toOffsetIsoString(new Date('2026-09-08T13:00:00.000Z'), 'Asia/Kolkata')).toBe(
      '2026-09-08T18:30:00+05:30',
    );
  });
});
