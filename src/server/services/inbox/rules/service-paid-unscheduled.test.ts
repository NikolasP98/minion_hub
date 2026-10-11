import { describe, it, expect } from 'vitest';
import { isStaleUnscheduled } from './service-paid-unscheduled';

describe('service.paid_unscheduled — isStaleUnscheduled boundary', () => {
  const submittedAt = new Date('2026-10-01T10:00:00Z');

  it('2 days 23h after submission is NOT stale', () => {
    const now = new Date(submittedAt.getTime() + (3 * 24 - 1) * 60 * 60 * 1000);
    expect(isStaleUnscheduled(submittedAt, now)).toBe(false);
  });

  it('exactly 3 days after submission IS stale (boundary is inclusive)', () => {
    const now = new Date(submittedAt.getTime() + 3 * 24 * 60 * 60 * 1000);
    expect(isStaleUnscheduled(submittedAt, now)).toBe(true);
  });

  it('3 days 1 hour after submission IS stale', () => {
    const now = new Date(submittedAt.getTime() + (3 * 24 + 1) * 60 * 60 * 1000);
    expect(isStaleUnscheduled(submittedAt, now)).toBe(true);
  });
});
