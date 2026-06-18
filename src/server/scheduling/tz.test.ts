import { describe, it, expect } from 'vitest';
import {
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
