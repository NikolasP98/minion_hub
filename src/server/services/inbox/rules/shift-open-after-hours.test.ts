import { describe, it, expect } from 'vitest';
import { isIdleLongEnough, isAfterHours } from './shift-open-after-hours';

describe('shift.open_after_hours — isIdleLongEnough boundary', () => {
  const lastActivity = new Date('2026-10-10T10:00:00Z');

  it('2h59 idle is NOT long enough', () => {
    const now = new Date(lastActivity.getTime() + (3 * 60 - 1) * 60 * 1000);
    expect(isIdleLongEnough(lastActivity, now)).toBe(false);
  });

  it('exactly 3h idle IS long enough', () => {
    const now = new Date(lastActivity.getTime() + 3 * 60 * 60 * 1000);
    expect(isIdleLongEnough(lastActivity, now)).toBe(true);
  });
});

describe('shift.open_after_hours — isAfterHours window boundary', () => {
  it('before the window start is after-hours', () => {
    expect(isAfterHours('08:59', '09:00', '18:00')).toBe(true);
  });

  it('exactly at window start is inside hours', () => {
    expect(isAfterHours('09:00', '09:00', '18:00')).toBe(false);
  });

  it('exactly at window end is after-hours (half-open [start, end))', () => {
    expect(isAfterHours('18:00', '09:00', '18:00')).toBe(true);
  });

  it('inside the window is inside hours', () => {
    expect(isAfterHours('12:00', '09:00', '18:00')).toBe(false);
  });
});
