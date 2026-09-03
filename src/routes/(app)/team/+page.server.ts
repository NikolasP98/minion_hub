import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getCoreCtx } from '$server/auth/core-ctx';
import { isModuleEnabled } from '$server/services/modules.service';
import { shouldMaskSensitive } from '$server/services/rbac.service';
import { getResourceSchedule, listEventTypes } from '$server/services/scheduling.service';
import { listBookings } from '$server/services/scheduling-bookings.service';
import {
  listEmployees,
  listHolidays,
  listLeaveTypes,
  listAllocations,
  listLeaveRequests,
} from '$server/services/hr.service';
import { listUsers } from '$server/services/user.service';

/** Local midnight `n` days from today (negative = past). */
function dayOffset(n: number): Date {
  const s = new Date();
  s.setHours(0, 0, 0, 0);
  s.setDate(s.getDate() + n);
  return s;
}

const iso = (d: Date) => d.toISOString().slice(0, 10);

/**
 * /team — HR system of record (spec 2026-09-02-hub-team-hr-module-spec S2–S4).
 * Members & access (TeamTab) keep loading through their own /api/users calls;
 * this loader feeds the Roster / Availability / Time off / Holidays tabs.
 */
export const load: PageServerLoad = async ({ locals, depends }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401, 'Authentication required');
  depends('team:data');
  // AvailabilityEditor invalidates this key after saving weekly hours.
  depends('scheduling:data');

  const year = new Date().getFullYear();
  const yearStart = `${year}-01-01`;
  const yearEnd = `${year}-12-31`;
  const weekStart = dayOffset(-3);
  const weekEnd = new Date(weekStart.getTime() + 7 * 86_400_000);

  const hrEnabled = await isModuleEnabled(ctx, 'scheduling');
  const myProfileId = locals.user?.supabaseId ?? null;

  // Org members (Supabase profiles). Degrade to [] so the page still renders.
  const members = locals.tenantCtx
    ? await listUsers(locals.tenantCtx).catch((e) => {
        console.warn('[team] listUsers failed, degrading:', e);
        return [] as Awaited<ReturnType<typeof listUsers>>;
      })
    : [];
  const memberRows = members.map((u) => ({
    id: u.id,
    email: u.email,
    displayName: u.displayName,
    role: u.role,
    accountType: u.accountType,
  }));

  if (!hrEnabled) {
    return {
      hrEnabled: false as const,
      myProfileId,
      members: memberRows,
      weekStart: iso(weekStart),
      employees: [],
      schedules: {},
      eventTypes: [],
      bookings: [],
      holidays: [],
      leaveTypes: [],
      allocations: [],
      requests: [],
    };
  }

  const [employees, holidays, leaveTypes, allocations, requests, eventTypes, bookings] =
    await Promise.all([
      listEmployees(ctx, { includeLeft: true }),
      listHolidays(ctx, yearStart, yearEnd),
      listLeaveTypes(ctx),
      listAllocations(ctx),
      listLeaveRequests(ctx, { from: yearStart, to: yearEnd }),
      listEventTypes(ctx),
      listBookings(ctx, {
        from: weekStart,
        to: weekEnd,
        status: ['accepted', 'pending', 'completed'],
        limit: 1000,
        maskAttendeePii: await shouldMaskSensitive(locals, 'scheduling'),
      }),
    ]);

  const schedules = Object.fromEntries(
    await Promise.all(
      employees
        .filter((e) => e.resourceId)
        .map(async (e) => [e.resourceId!, await getResourceSchedule(ctx, e.resourceId!)] as const),
    ),
  );

  return {
    hrEnabled: true as const,
    myProfileId,
    members: memberRows,
    weekStart: iso(weekStart),
    employees: employees.map((e) => ({
      id: e.id,
      profileId: e.profileId,
      resourceId: e.resourceId,
      name: e.name,
      email: e.email,
      designation: e.designation,
      status: e.status as 'active' | 'left',
      joinedOn: e.joinedOn,
      leftOn: e.leftOn,
      color: e.resource?.color ?? null,
    })),
    schedules,
    eventTypes: eventTypes.map((e) => ({ id: e.id, title: e.title })),
    bookings: bookings.map((b) => ({
      id: b.id,
      resourceId: b.resourceId,
      eventTypeId: b.eventTypeId,
      start: b.startTime.toISOString(),
      end: b.endTime.toISOString(),
      status: b.status,
      attendeeName: b.attendeeName,
    })),
    holidays: holidays.map((h) => ({
      id: h.id,
      date: h.date,
      name: h.name,
      weeklyOff: h.weeklyOff,
    })),
    leaveTypes: leaveTypes
      .filter((t) => t.active)
      .map((t) => ({ id: t.id, code: t.code, name: t.name, paid: t.paid })),
    allocations: allocations.map((a) => ({
      id: a.id,
      employeeId: a.employeeId,
      leaveTypeId: a.leaveTypeId,
      periodStart: a.periodStart,
      periodEnd: a.periodEnd,
      days: Number(a.days),
    })),
    requests: requests.map((r) => ({
      id: r.id,
      employeeId: r.employeeId,
      leaveTypeId: r.leaveTypeId,
      fromDate: r.fromDate,
      toDate: r.toDate,
      halfDay: r.halfDay,
      days: Number(r.days),
      reason: r.reason,
      status: r.status as 'pending' | 'approved' | 'rejected' | 'cancelled',
      decidedBy: r.decidedBy,
      decidedAt: r.decidedAt ? r.decidedAt.toISOString() : null,
    })),
  };
};
