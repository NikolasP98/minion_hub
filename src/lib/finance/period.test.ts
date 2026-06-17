import { describe, it, expect } from 'vitest';
import { parsePeriod } from './period';

describe('parsePeriod', () => {
  it('defaults to bucket=month when no params given', () => {
    const p = parsePeriod(new URL('http://x/'));
    expect(p.bucket).toBe('month');
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

  it('returns null for bad ISO dates', () => {
    const p = parsePeriod(new URL('http://x/?from=not-a-date&to=also-bad'));
    expect(p.from).toBeNull();
    expect(p.to).toBeNull();
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
