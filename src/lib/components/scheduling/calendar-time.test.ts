import { describe, expect, it } from 'vitest';
import {
  resolveCalendarInstant,
  resolveCalendarMutation,
  schedulingSlotWindow,
} from './calendar-time';

describe('calendar write-time conversion', () => {
  it('blocks a nonexistent wall slot before a caller can issue a request', () => {
    expect(resolveCalendarInstant('2026-03-08', 150, 'America/New_York')).toMatchObject({
      ok: false,
      kind: 'nonexistent',
    });
  });

  it('chooses the earlier fold candidate without a source offset', () => {
    expect(resolveCalendarInstant('2026-11-01', 90, 'America/New_York')).toMatchObject({
      ok: true,
      instant: new Date('2026-11-01T05:30:00.000Z'),
    });
  });

  it('preserves the source fold offset and absolute duration for a move', () => {
    expect(
      resolveCalendarMutation({
        mode: 'move',
        date: '2026-11-01',
        startMinutes: 90,
        endMinutes: 150,
        timeZone: 'America/New_York',
        sourceStart: '2026-01-10T06:30:00.000Z',
        sourceEnd: '2026-01-10T07:30:00.000Z',
      }),
    ).toEqual({
      ok: true,
      start: '2026-11-01T06:30:00.000Z',
      end: '2026-11-01T07:30:00.000Z',
    });
  });

  it('resolves a resize end independently and requires an increasing instant', () => {
    expect(
      resolveCalendarMutation({
        mode: 'resize',
        date: '2026-11-01',
        startMinutes: 30,
        endMinutes: 90,
        timeZone: 'America/New_York',
        sourceStart: '2025-11-02T04:30:00.000Z',
        sourceEnd: '2025-11-02T06:30:00.000Z',
      }),
    ).toEqual({
      ok: true,
      start: '2026-11-01T04:30:00.000Z',
      end: '2026-11-01T06:30:00.000Z',
    });
  });

  it('uses real 23-hour organization days for slot reads', () => {
    const result = schedulingSlotWindow('2026-03-08', 'America/New_York');
    expect(result.ok && result.to!.getTime() - result.from!.getTime()).toBe(23 * 3_600_000);
  });
});
