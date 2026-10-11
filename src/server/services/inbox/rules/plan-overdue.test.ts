import { describe, it, expect } from 'vitest';
import { isPlanOverdue } from './plan-overdue';

describe('plan.overdue — isPlanOverdue boundary', () => {
  const schedule = [
    { dueOn: '2026-10-10', amount: 50 },
    { dueOn: '2026-11-10', amount: 50 },
  ];

  it('instalment due today is NOT overdue (boundary is exclusive)', () => {
    expect(isPlanOverdue(schedule, 0, 100, '2026-10-10')).toBe(false);
  });

  it('instalment due yesterday IS overdue', () => {
    expect(isPlanOverdue(schedule, 0, 100, '2026-10-11')).toBe(true);
  });

  it('fully paid plan has no next instalment, so it is NOT overdue', () => {
    expect(isPlanOverdue(schedule, 100, 100, '2026-12-01')).toBe(false);
  });
});
