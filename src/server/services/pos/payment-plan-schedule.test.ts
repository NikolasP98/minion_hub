import { describe, expect, it } from 'vitest';
import { nextDueInstalment, readDueSchedule, validateDueSchedule } from './payment-plan-schedule';

const row = (amount: unknown, dueOn = '2026-10-03') => ({ dueOn, amount });

describe('payment-plan schedule agreement', () => {
  it.each([null, undefined, []])('preserves no-schedule behavior for %j', (raw) => {
    expect(readDueSchedule(raw, 100)).toEqual({ schedule: null, scheduleIssue: null });
    expect(validateDueSchedule(raw, 100)).toBeNull();
  });
  it('sorts valid dates stably without changing their amounts', () => {
    expect(validateDueSchedule([row(40, '2026-12-01'), row(10), row(50)], 100)).toEqual([
      row(10),
      row(50),
      row(40, '2026-12-01'),
    ]);
  });
  it.each([
    '2026-02-29',
    '1900-02-29',
    '2026-04-31',
    '2026-13-01',
    '2026-00-01',
    '2026-01-00',
    '0000-01-01',
    '26-01-01',
    '2026-1-01',
  ])('rejects impossible or malformed date %s', (date) => {
    expect(readDueSchedule([row(100, date)], 100).scheduleIssue).toBe('invalid_rows');
  });
  it.each(['2000-02-29', '2028-02-29', '0001-01-01', '9999-12-31'])(
    'admits Gregorian date %s',
    (date) => {
      expect(validateDueSchedule([row(100, date)], 100)).toEqual([row(100, date)]);
    },
  );
  it.each([0, -1, 0.001, 1.005, NaN, Infinity, null, undefined, 'bad', '90071992547409.91'])(
    'classifies invalid amount %s without dropping it',
    (amount) => {
      expect(readDueSchedule([row(100), row(amount)], 100)).toEqual({
        schedule: null,
        scheduleIssue: 'invalid_rows',
      });
      expect(() => validateDueSchedule([row(amount)], 100)).toThrowError(
        expect.objectContaining({ code: 'invalid_due_schedule' }),
      );
    },
  );
  it.each([{}, 'bad', 7, [null], [[row(100)]]])('classifies invalid structure %j', (raw) => {
    expect(readDueSchedule(raw, 100).scheduleIssue).toBe('invalid_rows');
  });
  it('checks row limit before row content, and row validity before sum', () => {
    expect(readDueSchedule(Array(366).fill(null), 100).scheduleIssue).toBe('too_many_rows');
    expect(readDueSchedule([row(100), row(-1)], 100).scheduleIssue).toBe('invalid_rows');
    expect(validateDueSchedule(Array(365).fill(row(0.01)), 3.65)).toHaveLength(365);
  });
  it.each([99.99, 100.01])('rejects a schedule sum of %s for principal 100', (amount) => {
    expect(readDueSchedule([row(amount)], 100).scheduleIssue).toBe('principal_mismatch');
    expect(() => validateDueSchedule([row(amount)], 100)).toThrowError(
      expect.objectContaining({ code: 'invalid_due_schedule' }),
    );
  });
  it('sums decimal rows exactly and exposes invalid stored principal as a read failure', () => {
    expect(validateDueSchedule([row(0.1), row(0.2)], 0.3)).toEqual([row(0.1), row(0.2)]);
    expect(() => readDueSchedule([row(100)], 'bad')).toThrowError(
      expect.objectContaining({ code: 'invalid_stored_amount' }),
    );
  });
});

describe('partial instalment collection', () => {
  const schedule = [row(60), row(40, '2026-11-03')];
  it.each([
    [0, 60],
    [40, 20],
    [59.99, 0.01],
    [60, 40],
    [99.99, 0.01],
  ])('paid %s suggests only %s', (paid, amount) => {
    expect(nextDueInstalment(schedule, paid, 100)?.amount).toBe(amount);
  });
  it.each([100, 110])('never suggests collection after principal is settled at %s', (paid) => {
    expect(nextDueInstalment(schedule, paid, 100)).toBeNull();
  });
  it('does not invent a due amount for invalid/mismatched legacy schedules', () => {
    expect(nextDueInstalment([row(90)], 40, 100)).toBeNull();
    expect(nextDueInstalment([row(100, 'soon')], 40, 100)).toBeNull();
  });
});
