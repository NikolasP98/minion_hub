import { describe, it, expect } from 'vitest';
import { expandClosureDays, CLOSURE_MAX_DAYS } from './closures';

const TZ = 'America/Lima'; // UTC-5, no DST

describe('expandClosureDays', () => {
  it('one day, a daily window, in the org timezone', () => {
    const r = expandClosureDays(
      { fromDate: '2026-11-30', startTime: '09:00', endTime: '14:00', reason: ' Viaje ' },
      TZ,
    );
    expect(r).toEqual({
      ok: true,
      reason: 'Viaje',
      days: [
        {
          startsAt: new Date('2026-11-30T14:00:00.000Z'),
          endsAt: new Date('2026-11-30T19:00:00.000Z'),
        },
      ],
    });
  });

  it('all day across a month boundary = one row per local day, midnight to midnight', () => {
    const r = expandClosureDays({ fromDate: '2026-11-29', toDate: '2026-12-02', reason: 'x' }, TZ);
    if (!r.ok) throw new Error(r.error);
    expect(r.days).toHaveLength(4);
    expect(r.days[0].startsAt.toISOString()).toBe('2026-11-29T05:00:00.000Z');
    expect(r.days[3].endsAt.toISOString()).toBe('2026-12-03T05:00:00.000Z');
  });

  it.each([
    [{ fromDate: '2026-11-30', reason: '  ' }, 'reason is required'],
    [{ fromDate: '2026-11-30', reason: 'x'.repeat(121) }, 'at most 120'],
    [{ fromDate: '2026-11-30', toDate: '2026-11-29', reason: 'x' }, 'before'],
    [{ fromDate: '2026-02-30', reason: 'x' }, 'invalid date'],
    [{ fromDate: '2026-11-30', startTime: '09:00', reason: 'x' }, 'HH:MM'],
    [{ fromDate: '2026-11-30', startTime: '14:00', endTime: '09:00', reason: 'x' }, 'after'],
    [{ fromDate: '2026-01-01', toDate: '2026-12-31', reason: 'x' }, `${CLOSURE_MAX_DAYS} days`],
  ])('refuses %j', (input, msg) => {
    const r = expandClosureDays(input, TZ);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain(msg);
  });
});
