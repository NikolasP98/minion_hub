/**
 * Pure leave rules, ported from frappe/hrms `leave_application.py`
 * (`get_number_of_leave_days`, `validate_leave_overlap`, `get_remaining_leaves`).
 * No DB here — the service feeds it rows; the test file is the spec.
 */

export type DateKey = string; // 'YYYY-MM-DD'

/** Inclusive list of date keys from `from` to `to` (UTC date math). */
export function dateKeysBetween(from: DateKey, to: DateKey): DateKey[] {
  const out: DateKey[] = [];
  const cur = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  for (; cur.getTime() <= end.getTime(); cur.setUTCDate(cur.getUTCDate() + 1))
    out.push(cur.toISOString().slice(0, 10));
  return out;
}

/**
 * Counted leave days: `date_diff + 1`, −0.5 for a half day, minus holidays
 * unless the type includes them. Returns 0 when every day is a holiday
 * (hrms refuses such an application; the service maps 0 → rejection).
 */
export function leaveDays(input: {
  from: DateKey;
  to: DateKey;
  halfDay?: boolean;
  holidays: ReadonlySet<DateKey>;
  includeHoliday?: boolean;
}): number {
  if (input.to < input.from) return 0;
  const keys = dateKeysBetween(input.from, input.to);
  const working = input.includeHoliday ? keys : keys.filter((k) => !input.holidays.has(k));
  if (working.length === 0) return 0;
  return input.halfDay && working.length === 1 ? 0.5 : working.length;
}

/** Two inclusive date ranges intersect. */
export function rangesOverlap(
  a: { from: DateKey; to: DateKey },
  b: { from: DateKey; to: DateKey },
): boolean {
  return a.from <= b.to && b.from <= a.to;
}

/** Statuses that block a new request on the same dates (hrms: Open + Approved). */
export const BLOCKING_STATUSES: ReadonlySet<string> = new Set(['pending', 'approved']);

export interface LeaveBalance {
  allocated: number;
  approved: number;
  pending: number;
  /** allocated − approved − pending */
  available: number;
}

/**
 * Balance for one employee + leave type inside an allocation period.
 * Requests are counted when they intersect the period (hrms counts by ledger
 * date; a request straddling two periods is rare enough to count once here).
 */
export function leaveBalance(input: {
  allocations: Array<{ periodStart: DateKey; periodEnd: DateKey; days: number }>;
  requests: Array<{ from: DateKey; to: DateKey; days: number; status: string }>;
  on: DateKey;
}): LeaveBalance {
  const period = input.allocations.find(
    (a) => a.periodStart <= input.on && input.on <= a.periodEnd,
  );
  const allocated = period ? period.days : 0;
  const inPeriod = period
    ? input.requests.filter((r) =>
        rangesOverlap(r, { from: period.periodStart, to: period.periodEnd }),
      )
    : [];
  const approved = inPeriod.filter((r) => r.status === 'approved').reduce((s, r) => s + r.days, 0);
  const pending = inPeriod.filter((r) => r.status === 'pending').reduce((s, r) => s + r.days, 0);
  return { allocated, approved, pending, available: allocated - approved - pending };
}

/** hrms `get_weekly_off_dates`: every date in [from, to] whose weekday is in `weeklyOff` (0=Sun…6=Sat). */
export function weeklyOffDates(
  from: DateKey,
  to: DateKey,
  weeklyOff: ReadonlyArray<number>,
): DateKey[] {
  const set = new Set(weeklyOff);
  return dateKeysBetween(from, to).filter((k) => set.has(new Date(`${k}T00:00:00Z`).getUTCDay()));
}

export type LeaveStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';

/** Status machine: pending → approved | rejected; approved → cancelled; pending → cancelled. */
export function canTransition(from: LeaveStatus, to: LeaveStatus): boolean {
  if (from === 'pending') return to === 'approved' || to === 'rejected' || to === 'cancelled';
  if (from === 'approved') return to === 'cancelled';
  return false;
}
