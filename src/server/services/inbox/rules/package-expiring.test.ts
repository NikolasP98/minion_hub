import { describe, it, expect } from 'vitest';
import { isExpiringSoon } from './package-expiring';

describe('package.expiring — isExpiringSoon boundary', () => {
  const today = '2026-10-10';

  it('expiring in 8 days is NOT within the 7-day window', () => {
    expect(isExpiringSoon('2026-10-18', today)).toBe(false);
  });

  it('expiring in exactly 7 days IS within the window (boundary is inclusive)', () => {
    expect(isExpiringSoon('2026-10-17', today)).toBe(true);
  });

  it('expiring today IS within the window', () => {
    expect(isExpiringSoon(today, today)).toBe(true);
  });

  it('already expired (yesterday) is NOT "expiring soon"', () => {
    expect(isExpiringSoon('2026-10-09', today)).toBe(false);
  });

  it('no expiry date is never "expiring soon"', () => {
    expect(isExpiringSoon(null, today)).toBe(false);
  });
});
