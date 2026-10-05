import { describe, expect, it } from 'vitest';
import { teamCalendarWindow } from './team-calendar-window';

describe('teamCalendarWindow', () => {
  it('chooses the organization year and day rather than the process day', () => {
    const now = new Date('2025-12-31T10:30:00.000Z');

    expect(teamCalendarWindow('Pacific/Kiritimati', now)).toMatchObject({
      today: '2026-01-01',
      yearStart: '2026-01-01',
      yearEnd: '2026-12-31',
      weekStart: '2025-12-29',
    });
    expect(teamCalendarWindow('Pacific/Honolulu', now)).toMatchObject({
      today: '2025-12-31',
      yearStart: '2025-01-01',
      yearEnd: '2025-12-31',
      weekStart: '2025-12-28',
    });
  });

  it('resolves the seven organization dates across a DST transition', () => {
    const window = teamCalendarWindow('America/New_York', new Date('2026-03-08T16:00:00.000Z'));

    expect(window.weekStart).toBe('2026-03-05');
    expect(window.from.toISOString()).toBe('2026-03-05T05:00:00.000Z');
    expect(window.to.toISOString()).toBe('2026-03-12T03:59:59.999Z');
    expect(window.to.getTime() - window.from.getTime() + 1).toBe(167 * 60 * 60 * 1000);
  });
});
