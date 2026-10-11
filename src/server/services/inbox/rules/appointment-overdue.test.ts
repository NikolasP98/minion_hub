import { describe, it, expect } from 'vitest';
import { isOverdue } from './appointment-overdue';

describe('appointment.overdue — isOverdue boundary', () => {
  const endTime = new Date('2026-10-10T10:00:00Z');

  it('29 minutes past end is NOT overdue (inside the 30-minute grace)', () => {
    const now = new Date(endTime.getTime() + 29 * 60 * 1000);
    expect(isOverdue(endTime, now)).toBe(false);
  });

  it('exactly 30 minutes past end is NOT overdue (boundary is exclusive)', () => {
    const now = new Date(endTime.getTime() + 30 * 60 * 1000);
    expect(isOverdue(endTime, now)).toBe(false);
  });

  it('31 minutes past end IS overdue', () => {
    const now = new Date(endTime.getTime() + 31 * 60 * 1000);
    expect(isOverdue(endTime, now)).toBe(true);
  });
});
