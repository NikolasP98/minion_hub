import { describe, expect, it } from 'vitest';
import {
  ZONED_FORMATTER_CACHE_LIMIT,
  checkedZonedDayWindow,
  dateKeyAddDays,
  dateKeyAddMonths,
  dateKeyAddYears,
  instantDateKey,
  resolveWallTime,
  startOfZonedDate,
  wallTimeCandidates,
  zonedFormatterCacheSizeForTests,
} from './zoned';

describe('zoned wall-time resolution', () => {
  it('projects an instant into negative, far-positive, and non-hour zones', () => {
    const at = new Date('2026-10-03T01:30:00.000Z');
    expect(instantDateKey(at, 'America/Lima')).toBe('2026-10-02');
    expect(instantDateKey(at, 'Pacific/Kiritimati')).toBe('2026-10-03');
    expect(
      resolveWallTime({ date: '2026-10-03', hour: 9, minute: 0 }, 'Asia/Kathmandu'),
    ).toMatchObject({
      ok: true,
      instant: new Date('2026-10-03T03:15:00.000Z'),
      offsetMinutes: 345,
    });
  });

  it('returns no candidate for a New York gap and two for its fold', () => {
    expect(
      wallTimeCandidates({ date: '2026-03-08', hour: 2, minute: 30 }, 'America/New_York'),
    ).toEqual([]);
    const fold = wallTimeCandidates(
      { date: '2026-11-01', hour: 1, minute: 30 },
      'America/New_York',
    )!;
    expect(fold.map((candidate) => candidate.instant.toISOString())).toEqual([
      '2026-11-01T05:30:00.000Z',
      '2026-11-01T06:30:00.000Z',
    ]);
    expect(
      resolveWallTime({ date: '2026-11-01', hour: 1, minute: 30 }, 'America/New_York', {
        preferredOffsetMinutes: -300,
      }),
    ).toMatchObject({ ok: true, kind: 'ambiguous', instant: new Date('2026-11-01T06:30:00.000Z') });
  });

  it('handles Lord Howe 30-minute gaps and folds without whole-hour assumptions', () => {
    expect(
      wallTimeCandidates({ date: '2026-10-04', hour: 2, minute: 15 }, 'Australia/Lord_Howe'),
    ).toEqual([]);
    const fold = wallTimeCandidates(
      { date: '2026-04-05', hour: 1, minute: 45 },
      'Australia/Lord_Howe',
    )!;
    expect(fold).toHaveLength(2);
    expect(fold[1].instant.getTime() - fold[0].instant.getTime()).toBe(30 * 60_000);
  });

  it('uses 23-hour and 25-hour local day windows', () => {
    const spring = checkedZonedDayWindow('2026-03-08', '2026-03-08', 'America/New_York');
    const fall = checkedZonedDayWindow('2026-11-01', '2026-11-01', 'America/New_York');
    expect(spring.ok && spring.to!.getTime() - spring.from!.getTime()).toBe(23 * 3_600_000);
    expect(fall.ok && fall.to!.getTime() - fall.from!.getTime()).toBe(25 * 3_600_000);
  });

  it('finds a midnight transition and returns nonexistent for a skipped local date', () => {
    const havana = startOfZonedDate('2020-03-08', 'America/Havana');
    expect(havana).toMatchObject({ ok: true });
    if (havana.ok) expect(instantDateKey(havana.instant, 'America/Havana')).toBe('2020-03-08');
    expect(startOfZonedDate('2011-12-30', 'Pacific/Apia')).toMatchObject({
      ok: false,
      kind: 'nonexistent',
    });
  });

  it('rejects malformed input and an unknown timezone', () => {
    expect(resolveWallTime({ date: '2026-02-30', hour: 9, minute: 0 }, 'UTC')).toMatchObject({
      ok: false,
      kind: 'invalid',
    });
    expect(
      resolveWallTime({ date: '2026-02-28', hour: 9, minute: 0 }, 'Mars/Olympus'),
    ).toMatchObject({
      ok: false,
      kind: 'invalid',
    });
  });
});

describe('ISO calendar-key arithmetic', () => {
  it('shifts days without an instant or browser timezone', () => {
    expect(dateKeyAddDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(dateKeyAddDays('2026-01-01', -1)).toBe('2025-12-31');
  });

  it('clamps month and year shifts instead of spilling', () => {
    expect(dateKeyAddMonths('2025-03-31', -1)).toBe('2025-02-28');
    expect(dateKeyAddMonths('2024-03-31', -1)).toBe('2024-02-29');
    expect(dateKeyAddYears('2024-02-29', -1)).toBe('2023-02-28');
  });

  it('keeps the Intl parts cache bounded', () => {
    const zones = Intl.supportedValuesOf('timeZone').slice(0, ZONED_FORMATTER_CACHE_LIMIT + 8);
    for (const zone of zones) instantDateKey(new Date('2026-01-01T00:00:00Z'), zone);
    expect(zonedFormatterCacheSizeForTests()).toBeLessThanOrEqual(ZONED_FORMATTER_CACHE_LIMIT);
  });
});
