import { describe, it, expect } from 'vitest';
import { evaluatePrefix } from './naming-series';

const T = new Date('2026-06-09T12:00:00Z');

describe('evaluatePrefix', () => {
  it('expands YYYY and keeps literals, stopping before the counter', () => {
    expect(evaluatePrefix('SO-.YYYY.-', T)).toBe('SO-2026-');
    expect(evaluatePrefix('TKT-.YYYY.-', T)).toBe('TKT-2026-');
  });
  it('supports month + multi-token prefixes', () => {
    expect(evaluatePrefix('BKG-.YYYY.-.MM.-', T)).toBe('BKG-2026-06-');
    expect(evaluatePrefix('.YY.', T)).toBe('26');
  });
  it('handles a bare literal prefix', () => {
    expect(evaluatePrefix('LEGACY-', T)).toBe('LEGACY-');
  });
});
