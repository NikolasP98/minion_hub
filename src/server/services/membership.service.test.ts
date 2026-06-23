import { describe, it, expect } from 'vitest';
import { addInterval } from './membership.service';

const d = (s: string) => new Date(s);

describe('addInterval', () => {
  it('adds days and weeks', () => {
    expect(addInterval(d('2026-01-01T00:00:00Z'), 'day', 10).toISOString()).toBe('2026-01-11T00:00:00.000Z');
    expect(addInterval(d('2026-01-01T00:00:00Z'), 'week', 2).toISOString()).toBe('2026-01-15T00:00:00.000Z');
  });
  it('adds months with end-of-month clamp', () => {
    expect(addInterval(d('2026-01-31T00:00:00Z'), 'month', 1).toISOString()).toBe('2026-02-28T00:00:00.000Z');
    expect(addInterval(d('2026-03-15T00:00:00Z'), 'month', 1).toISOString()).toBe('2026-04-15T00:00:00.000Z');
  });
  it('adds years (leap-day clamp)', () => {
    expect(addInterval(d('2024-02-29T00:00:00Z'), 'year', 1).toISOString()).toBe('2025-02-28T00:00:00.000Z');
  });
});
