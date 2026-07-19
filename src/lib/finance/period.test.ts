import { describe, it, expect } from 'vitest';
import { parsePeriod, resolvePeriodWindow } from './period';

describe('parsePeriod', () => {
  it('defaults to bucket=month and a rolling 12-month window', () => {
    const p = parsePeriod(new URL('http://x/'));
    expect(p.bucket).toBe('month');
    // Pre-filled with real dates rather than an unbounded all-time scan.
    const days = (Date.parse(p.to!) - Date.parse(p.from!)) / 86_400_000;
    expect(days).toBeGreaterThan(360);
    expect(days).toBeLessThan(370);
  });

  it('range=all opts out of the rolling default (open window)', () => {
    const p = parsePeriod(new URL('http://x/?range=all'));
    expect(p.from).toBeNull();
    expect(p.to).toBeNull();
  });

  it('accepts valid bucket values', () => {
    expect(parsePeriod(new URL('http://x/?bucket=day')).bucket).toBe('day');
    expect(parsePeriod(new URL('http://x/?bucket=week')).bucket).toBe('week');
    expect(parsePeriod(new URL('http://x/?bucket=month')).bucket).toBe('month');
  });

  it('falls back to month for invalid bucket', () => {
    expect(parsePeriod(new URL('http://x/?bucket=year')).bucket).toBe('month');
    expect(parsePeriod(new URL('http://x/?bucket=')).bucket).toBe('month');
    expect(parsePeriod(new URL('http://x/?bucket=MONTH')).bucket).toBe('month');
  });

  it('parses valid ISO dates', () => {
    const p = parsePeriod(new URL('http://x/?from=2026-01-01&to=2026-06-01'));
    expect(p.from).toBe(new Date('2026-01-01').toISOString());
    expect(p.to).toBe(new Date('2026-06-01').toISOString());
  });

  it('falls back to the rolling default when both dates are unparseable', () => {
    const p = parsePeriod(new URL('http://x/?from=not-a-date&to=also-bad'));
    const days = (Date.parse(p.to!) - Date.parse(p.from!)) / 86_400_000;
    expect(days).toBeGreaterThan(360);
  });

  it('swaps from and to when from > to', () => {
    const p = parsePeriod(new URL('http://x/?from=2026-06-01&to=2026-01-01'));
    expect(new Date(p.from!).getTime()).toBeLessThan(new Date(p.to!).getTime());
  });

  it('does not swap when from === to', () => {
    const p = parsePeriod(new URL('http://x/?from=2026-03-01&to=2026-03-01'));
    expect(p.from).toBe(p.to);
  });
});

describe('resolvePeriodWindow (business timezone)', () => {
  it('brackets a single Lima day, including its evening sales', () => {
    const p = parsePeriod(new URL('http://x/?from=2026-06-01&to=2026-06-01'));
    const w = resolvePeriodWindow(p, 'America/Lima');
    expect(w.from).toBe('2026-06-01T05:00:00.000Z');
    expect(w.to).toBe('2026-06-02T05:00:00.000Z');
    // 19:30 Lima == 00:30Z next day — inside the Lima window, outside a UTC one.
    const evening = Date.parse('2026-06-02T00:30:00.000Z');
    expect(evening).toBeGreaterThanOrEqual(Date.parse(w.from!));
    expect(evening).toBeLessThan(Date.parse(w.to!));
  });

  it('keeps an open window open', () => {
    const w = resolvePeriodWindow({ from: null, to: null, bucket: 'month' }, 'America/Lima');
    expect(w.from).toBeNull();
    expect(w.to).toBeNull();
  });
});
