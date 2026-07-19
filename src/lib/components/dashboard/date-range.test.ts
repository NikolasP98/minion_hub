import { describe, it, expect } from 'vitest';
import {
  daysBetween,
  periodEnabled,
  coercePeriod,
  quickRange,
  matchQuickRange,
} from './date-range';

const NOW = new Date('2026-07-19T00:00:00Z');

describe('date-range', () => {
  it('smart period enabling by span (15d disables month + year)', () => {
    const from = '2026-07-04';
    const to = '2026-07-19'; // 15 days
    expect(daysBetween(from, to)).toBe(15);
    expect(periodEnabled('day', from, to)).toBe(true);
    expect(periodEnabled('week', from, to)).toBe(true);
    expect(periodEnabled('month', from, to)).toBe(false);
    expect(periodEnabled('year', from, to)).toBe(false);
  });

  it('open (all-time) range enables every period', () => {
    expect(periodEnabled('year', '', '')).toBe(true);
    expect(periodEnabled('year', '2026-01-01', '')).toBe(true);
  });

  it('coerces a now-disabled period down to the coarsest enabled one', () => {
    // month disabled on a 15d range → fall back to week
    expect(coercePeriod('month', '2026-07-04', '2026-07-19')).toBe('week');
    // still valid → unchanged
    expect(coercePeriod('day', '2026-07-04', '2026-07-19')).toBe('day');
  });

  it('quick ranges compute inclusive-friendly from/to', () => {
    expect(quickRange('7d', NOW)).toEqual({ from: '2026-07-12', to: '2026-07-19' });
    expect(quickRange('ytd', NOW)).toEqual({ from: '2026-01-01', to: '2026-07-19' });
    expect(quickRange('all', NOW)).toEqual({ from: '', to: '' });
    expect(quickRange('all', NOW, '2024-03-01')).toEqual({ from: '2024-03-01', to: '' });
  });

  it('matches a quick range back from from/to', () => {
    expect(matchQuickRange('2026-07-12', '2026-07-19', ['1d', '7d', '30d'], NOW)).toBe('7d');
    expect(matchQuickRange('2020-01-01', '2026-07-19', ['1d', '7d', '30d'], NOW)).toBe(null);
  });
});
