import type { LeaveStatus, TeamAllocation, TeamLeaveRequest, TeamLeaveType } from './types';
import { todayKey } from './types';

export interface BalanceRow {
  id: string;
  employeeId: string;
  employee: string;
  type: string;
  allocated: number;
  approved: number;
  pending: number;
  available: number;
}

/** hrms leave balance report: allocation covering today, per employee × leave type. */
export function leaveBalances(
  employees: { id: string; name: string }[],
  leaveTypes: TeamLeaveType[],
  allocations: TeamAllocation[],
  requests: TeamLeaveRequest[],
  today = todayKey(),
): BalanceRow[] {
  return employees.flatMap((e) =>
    leaveTypes.flatMap((t) => {
      const allocs = allocations.filter(
        (a) =>
          a.employeeId === e.id &&
          a.leaveTypeId === t.id &&
          a.periodStart <= today &&
          today <= a.periodEnd,
      );
      if (!allocs.length) return [];
      const start = allocs.map((a) => a.periodStart).sort()[0];
      const end = allocs
        .map((a) => a.periodEnd)
        .sort()
        .at(-1)!;
      const inPeriod = requests.filter(
        (r) =>
          r.employeeId === e.id && r.leaveTypeId === t.id && r.fromDate <= end && r.toDate >= start,
      );
      const sum = (s: LeaveStatus) =>
        inPeriod.filter((r) => r.status === s).reduce((n, r) => n + r.days, 0);
      const allocated = allocs.reduce((n, a) => n + a.days, 0);
      const approved = sum('approved');
      const pending = sum('pending');
      return [
        {
          id: `${e.id}:${t.id}`,
          employeeId: e.id,
          employee: e.name,
          type: t.name,
          allocated,
          approved,
          pending,
          available: allocated - approved - pending,
        },
      ];
    }),
  );
}
