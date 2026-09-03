import { describe, it, expect } from 'vitest';
import {
  leaveDays,
  rangesOverlap,
  leaveBalance,
  weeklyOffDates,
  staleWeeklyOffDates,
  canTransition,
  dateKeysBetween,
} from './leave-rules';

describe('leaveDays (hrms get_number_of_leave_days)', () => {
  const holidays = new Set(['2026-09-07']); // Monday holiday
  it('counts date_diff + 1', () => {
    expect(leaveDays({ from: '2026-09-01', to: '2026-09-03', holidays: new Set() })).toBe(3);
  });
  it('excludes holidays unless the type includes them', () => {
    expect(leaveDays({ from: '2026-09-07', to: '2026-09-08', holidays })).toBe(1);
    expect(
      leaveDays({ from: '2026-09-07', to: '2026-09-08', holidays, includeHoliday: true }),
    ).toBe(2);
  });
  it('is 0 when every day is a holiday (application refused upstream)', () => {
    expect(leaveDays({ from: '2026-09-07', to: '2026-09-07', holidays })).toBe(0);
  });
  it('half day only applies to a single working day', () => {
    expect(leaveDays({ from: '2026-09-08', to: '2026-09-08', halfDay: true, holidays })).toBe(0.5);
    expect(leaveDays({ from: '2026-09-08', to: '2026-09-09', halfDay: true, holidays })).toBe(2);
  });
  it('rejects an inverted range', () => {
    expect(leaveDays({ from: '2026-09-09', to: '2026-09-08', holidays })).toBe(0);
  });
});

describe('rangesOverlap (hrms validate_leave_overlap)', () => {
  it('detects touching and nested ranges, not disjoint ones', () => {
    expect(
      rangesOverlap(
        { from: '2026-09-01', to: '2026-09-03' },
        { from: '2026-09-03', to: '2026-09-05' },
      ),
    ).toBe(true);
    expect(
      rangesOverlap(
        { from: '2026-09-01', to: '2026-09-10' },
        { from: '2026-09-04', to: '2026-09-05' },
      ),
    ).toBe(true);
    expect(
      rangesOverlap(
        { from: '2026-09-01', to: '2026-09-03' },
        { from: '2026-09-04', to: '2026-09-05' },
      ),
    ).toBe(false);
  });
});

describe('leaveBalance (hrms get_remaining_leaves)', () => {
  const allocations = [{ periodStart: '2026-01-01', periodEnd: '2026-12-31', days: 15 }];
  it('is allocated − approved − pending inside the period', () => {
    const b = leaveBalance({
      allocations,
      on: '2026-09-02',
      requests: [
        { from: '2026-02-02', to: '2026-02-06', days: 5, status: 'approved' },
        { from: '2026-10-05', to: '2026-10-06', days: 2, status: 'pending' },
        { from: '2026-03-02', to: '2026-03-03', days: 2, status: 'rejected' },
        { from: '2025-12-29', to: '2025-12-30', days: 2, status: 'approved' }, // previous period
      ],
    });
    expect(b).toEqual({ allocated: 15, approved: 5, pending: 2, available: 8 });
  });
  it('is zero without an allocation covering the date', () => {
    expect(leaveBalance({ allocations, on: '2027-01-01', requests: [] }).available).toBe(0);
  });
});

describe('weeklyOffDates (hrms get_weekly_off_dates)', () => {
  it('materialises Sundays in September 2026', () => {
    expect(weeklyOffDates('2026-09-01', '2026-09-30', [0])).toEqual([
      '2026-09-06',
      '2026-09-13',
      '2026-09-20',
      '2026-09-27',
    ]);
  });
  it('staleWeeklyOffDates keeps only dates whose weekday was unchecked', () => {
    const materialised = ['2026-09-05', '2026-09-06', '2026-09-12', '2026-09-13']; // Sat, Sun
    expect(staleWeeklyOffDates(materialised, [0])).toEqual(['2026-09-05', '2026-09-12']);
    expect(staleWeeklyOffDates(materialised, [0, 6])).toEqual([]);
    expect(staleWeeklyOffDates(materialised, [])).toEqual(materialised);
  });
  it('dateKeysBetween is inclusive', () => {
    expect(dateKeysBetween('2026-09-29', '2026-10-01')).toEqual([
      '2026-09-29',
      '2026-09-30',
      '2026-10-01',
    ]);
  });
});

describe('canTransition (Open → Approved/Rejected; Approved → Cancelled)', () => {
  it('follows the hrms status machine', () => {
    expect(canTransition('pending', 'approved')).toBe(true);
    expect(canTransition('pending', 'rejected')).toBe(true);
    expect(canTransition('pending', 'cancelled')).toBe(true);
    expect(canTransition('approved', 'cancelled')).toBe(true);
    expect(canTransition('approved', 'pending')).toBe(false);
    expect(canTransition('rejected', 'approved')).toBe(false);
    expect(canTransition('cancelled', 'approved')).toBe(false);
  });
});
