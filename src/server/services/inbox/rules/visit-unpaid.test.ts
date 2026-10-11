import { describe, it, expect } from 'vitest';
import { isStaleCompleted, isVisitFunded } from './visit-unpaid';

describe('visit.unpaid — isStaleCompleted boundary', () => {
  const updatedAt = new Date('2026-10-10T10:00:00Z');

  it('3h59 after completion is NOT stale', () => {
    const now = new Date(updatedAt.getTime() + (4 * 60 - 1) * 60 * 1000);
    expect(isStaleCompleted(updatedAt, now)).toBe(false);
  });

  it('exactly 4h after completion IS stale', () => {
    const now = new Date(updatedAt.getTime() + 4 * 60 * 60 * 1000);
    expect(isStaleCompleted(updatedAt, now)).toBe(true);
  });

  it('4h01 after completion IS stale', () => {
    const now = new Date(updatedAt.getTime() + (4 * 60 + 1) * 60 * 1000);
    expect(isStaleCompleted(updatedAt, now)).toBe(true);
  });
});

describe('visit.unpaid — isVisitFunded (paid vs plan-funded)', () => {
  it('no line, no redemption, no plan → unfunded', () => {
    expect(isVisitFunded(false, false, false)).toBe(false);
  });

  it('a non-voided ticket line → funded (paid)', () => {
    expect(isVisitFunded(true, false, false)).toBe(true);
  });

  it('a live package redemption with no ticket line → funded (package-covered)', () => {
    expect(isVisitFunded(false, true, false)).toBe(true);
  });

  it('an active payment plan with no ticket line → funded (plan-funded)', () => {
    expect(isVisitFunded(false, false, true)).toBe(true);
  });
});
