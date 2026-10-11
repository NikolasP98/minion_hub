import { describe, it, expect } from 'vitest';
import { isBirthdayToday } from './crm-birthday';

describe('crm.birthday — isBirthdayToday boundary', () => {
  it('same month-day, different birth year, IS a match', () => {
    expect(isBirthdayToday('1990-10-10', '2026-10-10')).toBe(true);
  });

  it('one day off is NOT a match', () => {
    expect(isBirthdayToday('1990-10-11', '2026-10-10')).toBe(false);
  });

  it('no dob is never a match', () => {
    expect(isBirthdayToday(null, '2026-10-10')).toBe(false);
  });

  it('shortcut: Feb-29 dob does not fall back to Feb-28 in a non-leap year', () => {
    expect(isBirthdayToday('1992-02-29', '2026-02-28')).toBe(false);
  });
});
