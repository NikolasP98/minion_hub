import { PosError } from './errors';
import { moneyMinor, moneyNumber, storedMinorNumber, storedMoneyMinor } from './money';

export interface DueInstalment {
  dueOn: string;
  amount: number;
}

export type ScheduleIssue = 'invalid_rows' | 'principal_mismatch' | 'too_many_rows';
export interface DueScheduleRead {
  schedule: DueInstalment[] | null;
  scheduleIssue: ScheduleIssue | null;
}

/** Date-only Gregorian validation, including leap centuries, without timezone conversion. */
function isGregorianDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  if (year < 1 || month < 1 || month > 12 || day < 1) return false;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day <= days[month - 1];
}

/** Advisory legacy data is classified as a whole; no row is silently discarded. */
export function readDueSchedule(raw: unknown, principal: string | number): DueScheduleRead {
  const invalid = (scheduleIssue: ScheduleIssue): DueScheduleRead => ({
    schedule: null,
    scheduleIssue,
  });
  if (raw == null || (Array.isArray(raw) && raw.length === 0)) {
    return { schedule: null, scheduleIssue: null };
  }
  if (!Array.isArray(raw)) return invalid('invalid_rows');
  if (raw.length > 365) return invalid('too_many_rows');
  const schedule: DueInstalment[] = [];
  let sum = 0n;
  for (const entry of raw) {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry))
      return invalid('invalid_rows');
    const { dueOn, amount } = entry as { dueOn?: unknown; amount?: unknown };
    if (!isGregorianDate(dueOn)) return invalid('invalid_rows');
    try {
      const minor = moneyMinor(amount, { exact: true, code: 'invalid_due_schedule' });
      if (minor <= 0n) return invalid('invalid_rows');
      schedule.push({
        dueOn,
        amount: moneyNumber(amount, { exact: true, code: 'invalid_due_schedule' }),
      });
      sum += minor;
    } catch (error) {
      if (!(error instanceof PosError) || error.code !== 'invalid_due_schedule') throw error;
      return invalid('invalid_rows');
    }
  }
  // Principal corruption is a financial-read failure, not an advisory schedule issue.
  if (sum !== storedMoneyMinor(principal, true)) return invalid('principal_mismatch');
  // ECMAScript stable sort retains the operator's ordering for equal date keys.
  schedule.sort((a, b) => a.dueOn.localeCompare(b.dueOn));
  return { schedule, scheduleIssue: null };
}

export function validateDueSchedule(
  raw: unknown,
  principal: string | number,
): DueInstalment[] | null {
  const result = readDueSchedule(raw, principal);
  if (result.scheduleIssue) {
    throw new PosError(
      'The due schedule must contain valid dates and positive cent amounts that sum to the principal.',
      'invalid_due_schedule',
    );
  }
  return result.schedule;
}

/** Consume paid cents in date order and expose only the still-unpaid part of the next row. */
export function nextDueInstalment(
  dueSchedule: unknown,
  paidToDate: string | number,
  principal: string | number,
): DueInstalment | null {
  const principalMinor = storedMoneyMinor(principal, true);
  let covered = storedMoneyMinor(paidToDate);
  const remaining = principalMinor - covered;
  if (remaining <= 0n) return null;
  const { schedule } = readDueSchedule(dueSchedule, principal);
  if (!schedule) return null;
  // A legacy negative paid total does not enlarge a scheduled row. Progress still exposes it.
  if (covered < 0n) covered = 0n;
  for (const instalment of schedule) {
    const amount = storedMoneyMinor(instalment.amount);
    if (covered >= amount) {
      covered -= amount;
      continue;
    }
    const unpaid = amount - covered;
    return {
      dueOn: instalment.dueOn,
      amount: storedMinorNumber(unpaid < remaining ? unpaid : remaining),
    };
  }
  return null;
}
