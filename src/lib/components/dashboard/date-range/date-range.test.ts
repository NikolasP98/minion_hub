import { describe, it, expect } from 'vitest';
import {
  ALL_PERIODS_WITH_TIME,
  SUBDAY_RANGE_IDS,
  DATE_RANGE_IDS,
  isSubDayRange,
  daysBetween,
  periodEnabled,
  enabledPeriods,
  coercePeriod,
  resolveRange,
  matchRange,
  orderRangeIds,
  toSearchParams,
  fromSearchParams,
  toTimestamps,
  fromTimestamps,
  defaultRangeConfig,
  toggleRangeVisible,
  setDefaultRange,
  zonedDayWindow,
} from './index';

const NOW = new Date('2026-07-19T00:00:00Z');
const ctx = { now: NOW };

describe('periods', () => {
  it('disables periods too coarse for the span (15d → no month/year)', () => {
    const from = '2026-07-04';
    const to = '2026-07-19';
    expect(daysBetween(from, to)).toBe(15);
    expect(periodEnabled('day', from, to)).toBe(true);
    expect(periodEnabled('week', from, to)).toBe(true);
    expect(periodEnabled('month', from, to)).toBe(false);
    expect(periodEnabled('year', from, to)).toBe(false);
    expect(enabledPeriods(from, to)).toEqual(['day', 'week']);
  });

  it('treats an open window as unmeasurable → all periods stay available', () => {
    expect(periodEnabled('year', '', '')).toBe(true);
    expect(enabledPeriods('', '')).toEqual(['day', 'week', 'month', 'year']);
  });

  it('snaps a disabled period down to the coarsest enabled one', () => {
    expect(coercePeriod('month', '2026-07-04', '2026-07-19')).toBe('week');
    expect(coercePeriod('day', '2026-07-04', '2026-07-19')).toBe('day');
    // respects the allowed subset (finances has no year bucket)
    expect(coercePeriod('year', '2020-01-01', '2026-07-19', ['day', 'week', 'month'])).toBe('month');
  });
});

describe('ranges', () => {
  it('resolves relative windows against a reference now', () => {
    expect(resolveRange('7d', ctx)).toEqual({ from: '2026-07-12', to: '2026-07-19' });
    expect(resolveRange('ytd', ctx)).toEqual({ from: '2026-01-01', to: '2026-07-19' });
  });

  it('resolves "all" to the real data span so inputs show real dates', () => {
    expect(resolveRange('all', ctx)).toEqual({ from: '', to: '' });
    expect(resolveRange('all', { ...ctx, dataMin: '2024-03-01', dataMax: '2026-07-01' })).toEqual({
      from: '2024-03-01',
      to: '2026-07-01',
    });
  });

  it('matches a window back to its range id', () => {
    expect(matchRange({ from: '2026-07-12', to: '2026-07-19' }, ['1d', '7d'], ctx)).toBe('7d');
    expect(matchRange({ from: '2020-01-01', to: '2026-07-19' }, ['1d', '7d'], ctx)).toBe(null);
  });

  it('keeps ids in canonical registry order', () => {
    expect(orderRangeIds(['all', '7d', 'ytd'])).toEqual(['7d', 'ytd', 'all']);
  });
});

describe('url adapters', () => {
  it('round-trips a window through search params', () => {
    const p = toSearchParams({ from: '2026-01-01', to: '2026-07-19', period: 'month' }, { periodKey: 'bucket' });
    expect(p.get('from')).toBe('2026-01-01');
    expect(p.get('bucket')).toBe('month');
    expect(fromSearchParams(p, { periodKey: 'bucket' })).toEqual({
      from: '2026-01-01',
      to: '2026-07-19',
      period: 'month',
    });
  });

  it('writes/reads the all-time sentinel for an open window', () => {
    const p = toSearchParams({ from: '', to: '' }, { allKey: 'range' });
    expect(p.get('range')).toBe('all');
    expect(fromSearchParams(p, { allKey: 'range' })).toMatchObject({ from: '', to: '' });
  });

  it('timestamp bounds are INCLUSIVE of the whole `to` day', () => {
    const { fromTs, toTs } = toTimestamps({ from: '2026-06-01', to: '2026-06-01' });
    // a same-day record at 19:30 must fall inside a from==to window
    const sameDayEvening = Date.parse('2026-06-01T19:30:00.000');
    expect(sameDayEvening).toBeGreaterThanOrEqual(fromTs);
    expect(sameDayEvening).toBeLessThanOrEqual(toTs);
  });

  it('open bounds become infinite, and round-trip back to empty', () => {
    const { fromTs, toTs } = toTimestamps({ from: '', to: '' });
    expect(fromTs).toBe(-Infinity);
    expect(toTs).toBe(Infinity);
    expect(fromTimestamps(fromTs, toTs)).toEqual({ from: '', to: '' });
  });
});

describe('storage config', () => {
  it('toggles visibility, keeps at least one, and clears a hidden default', () => {
    let cfg = defaultRangeConfig(['7d', '30d']);
    cfg = setDefaultRange(cfg, '7d');
    expect(cfg.default).toBe('7d');

    cfg = toggleRangeVisible(cfg, '7d'); // hiding the default clears it
    expect(cfg.visible).toEqual(['30d']);
    expect(cfg.default).toBe(null);

    const only = toggleRangeVisible(cfg, '30d'); // last one can't be hidden
    expect(only.visible).toEqual(['30d']);
  });

  it('showing a range keeps canonical order; setting a default reveals it', () => {
    let cfg = defaultRangeConfig(['30d']);
    cfg = toggleRangeVisible(cfg, '7d');
    expect(cfg.visible).toEqual(['7d', '30d']);

    cfg = setDefaultRange(cfg, 'all');
    expect(cfg.visible).toEqual(['7d', '30d', 'all']);
    expect(cfg.default).toBe('all');
  });
});

describe('sub-day (time-of-day opt-in)', () => {
  it('keeps sub-day ranges out of the date-granular set', () => {
    expect(SUBDAY_RANGE_IDS).toEqual(['1h', '6h', '24h']);
    expect(DATE_RANGE_IDS).not.toContain('1h');
    expect(isSubDayRange('1h')).toBe(true);
    expect(isSubDayRange('7d')).toBe(false);
  });

  it('resolves a sub-day range to datetime bounds an hour apart', () => {
    const r = resolveRange('1h', ctx)!;
    expect(r.from).toContain('T');
    expect(r.to).toContain('T');
    const { fromTs, toTs } = toTimestamps(r);
    expect(toTs - fromTs).toBe(3_600_000);
  });

  it('hour is viewable for short windows and too FINE for long ones', () => {
    const short = resolveRange('24h', ctx)!;
    expect(periodEnabled('hour', short.from, short.to)).toBe(true);
    // 30 days of hourly buckets = 720 bars → disabled by the max-span rule
    expect(periodEnabled('hour', '2026-06-19', '2026-07-19')).toBe(false);
  });

  it('coerces hour away once the window grows past the hourly cap', () => {
    // 30d: hour is too fine → snap to the coarsest viewable period
    expect(coercePeriod('hour', '2026-06-19', '2026-07-19', ALL_PERIODS_WITH_TIME)).toBe('month');
    // 1d: 24 hourly bars is perfectly readable → hour is kept
    expect(coercePeriod('hour', '2026-07-18', '2026-07-19', ALL_PERIODS_WITH_TIME)).toBe('hour');
  });

  it('datetime bounds are used verbatim (not widened to the whole day)', () => {
    const { fromTs, toTs } = toTimestamps({ from: '2026-06-01T08:00', to: '2026-06-01T09:30' });
    expect(toTs - fromTs).toBe(90 * 60_000);
  });
});

describe('business-timezone day windows', () => {
  it('brackets a Lima day at 05:00Z..05:00Z (UTC-5), not 00:00Z', () => {
    const w = zonedDayWindow('2026-06-01', '2026-06-01', 'America/Lima');
    expect(w.from!.toISOString()).toBe('2026-06-01T05:00:00.000Z');
    expect(w.to!.toISOString()).toBe('2026-06-02T05:00:00.000Z');
  });

  it('includes a 19:30 Lima sale that a UTC day window would drop', () => {
    // 2026-06-01 19:30 Lima == 2026-06-02 00:30Z
    const sale = Date.parse('2026-06-02T00:30:00.000Z');
    const lima = zonedDayWindow('2026-06-01', '2026-06-01', 'America/Lima');
    expect(sale).toBeGreaterThanOrEqual(lima.from!.getTime());
    expect(sale).toBeLessThan(lima.to!.getTime());
    // the old UTC-day window excluded it
    const utcEnd = Date.parse('2026-06-02T00:00:00.000Z');
    expect(sale).toBeGreaterThanOrEqual(utcEnd);
  });

  it('is UTC-identical for a UTC business', () => {
    const w = zonedDayWindow('2026-06-01', '2026-06-01', 'UTC');
    expect(w.from!.toISOString()).toBe('2026-06-01T00:00:00.000Z');
    expect(w.to!.toISOString()).toBe('2026-06-02T00:00:00.000Z');
  });

  it('handles a multi-day span and open bounds', () => {
    const w = zonedDayWindow('2026-06-01', '2026-06-30', 'America/Lima');
    expect(w.from!.toISOString()).toBe('2026-06-01T05:00:00.000Z');
    expect(w.to!.toISOString()).toBe('2026-07-01T05:00:00.000Z');
    expect(zonedDayWindow('', '', 'America/Lima')).toEqual({ from: null, to: null });
  });
})
