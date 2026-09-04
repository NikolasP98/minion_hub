import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getCoreCtx } from '$server/auth/core-ctx';
import { isModuleEnabled } from '$server/services/modules.service';
import {
  getOrgMemberRolesAll,
  hasOrgCapability,
  listRoleCatalog,
  shouldMaskSensitive,
} from '$server/services/rbac.service';
import {
  getResourceSchedule,
  listEventTypes,
  listResources,
} from '$server/services/scheduling.service';
import { listBookings } from '$server/services/scheduling-bookings.service';
import {
  listEmployees,
  listHolidays,
  listLeaveTypes,
  listAllocations,
  listLeaveRequests,
  getHrSettings,
} from '$server/services/hr.service';
import { listOrganizations, listUsers } from '$server/services/user.service';

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
 * Feeds the People (roster + availability + access) / Time off / Rooms tabs.
 * Access data (role catalog, per-member RBAC roles, orgs for join links) only
 * loads for users.manage holders — the People detail hides the section otherwise.
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
  // Access controls (People → Access section) — same sources as settings/team.
  const manageUsers = await hasOrgCapability(locals, 'users', 'manage');
  const tenantCtx = locals.tenantCtx;
  const [rbacRoles, memberRoleMap, organizations] =
    manageUsers && tenantCtx
      ? await Promise.all([
          listRoleCatalog(tenantCtx.tenantId).catch((e) => {
            console.warn('[team] listRoleCatalog failed, degrading:', e);
            return [] as Awaited<ReturnType<typeof listRoleCatalog>>;
          }),
          getOrgMemberRolesAll(tenantCtx.tenantId).catch((e) => {
            console.warn('[team] getOrgMemberRolesAll failed, degrading:', e);
            return new Map<string, string[]>();
          }),
          listOrganizations(tenantCtx).catch((e) => {
            console.warn('[team] listOrganizations failed, degrading:', e);
            return [] as Awaited<ReturnType<typeof listOrganizations>>;
          }),
        ])
      : [[], new Map<string, string[]>(), []];
  const memberRows = members.map((u) => ({
    id: u.id,
    email: u.email,
    displayName: u.displayName,
    role: u.role,
    accountType: u.accountType,
    // Falls back to viewer when unassigned (mirrors settings/team).
    memberRoles: manageUsers ? (memberRoleMap.get(u.id) ?? ['viewer']) : [],
  }));
  const rbacRoleRows = rbacRoles.map((r) => ({
    key: r.key,
    name: r.name,
    rank: r.rank,
    description: r.description,
  }));
  const organizationRows = organizations.map((o) => ({ id: o.id, name: o.name }));

  if (!hrEnabled) {
    return {
      hrEnabled: false as const,
      myProfileId,
      members: memberRows,
      rbacRoles: rbacRoleRows,
      organizations: organizationRows,
      weekStart: iso(weekStart),
      myEmployeeId: null,
      employees: [],
      resources: [],
      schedules: {},
      eventTypes: [],
      bookings: [],
      holidays: [],
      hrSettings: { weeklyOff: [], country: null },
      leaveTypes: [],
      allocations: [],
      requests: [],
    };
  }

  const [
    employees,
    allResources,
    holidays,
    leaveTypes,
    allocations,
    requests,
    eventTypes,
    bookings,
    hrSettings,
  ] = await Promise.all([
    listEmployees(ctx, { includeLeft: true }),
    listResources(ctx),
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
    getHrSettings(ctx),
  ]);

  // Rooms & equipment: non-staff resources (spec §2 — no employee row, ever).
  const resources = allResources.filter((r) => r.kind !== 'staff');
  const scheduleIds = [
    ...employees.flatMap((e) => (e.resourceId ? [e.resourceId] : [])),
    ...resources.map((r) => r.id),
  ];
  const schedules = Object.fromEntries(
    await Promise.all(
      scheduleIds.map(async (id) => [id, await getResourceSchedule(ctx, id)] as const),
    ),
  );

  return {
    hrEnabled: true as const,
    myProfileId,
    // The viewer's own employee row — approve/reject are hidden on their own requests.
    myEmployeeId: myProfileId
      ? (employees.find((e) => e.profileId === myProfileId)?.id ?? null)
      : null,
    members: memberRows,
    rbacRoles: rbacRoleRows,
    organizations: organizationRows,
    weekStart: iso(weekStart),
    employees: employees.map((e) => ({
      id: e.id,
      profileId: e.profileId,
      resourceId: e.resourceId,
      name: e.name,
      email: e.email,
      designation: e.designation,
      department: e.department,
      employmentType: e.employmentType,
      status: e.status as 'active' | 'left',
      joinedOn: e.joinedOn,
      leftOn: e.leftOn,
      color: e.resource?.color ?? null,
    })),
    resources: resources.map((r) => ({
      id: r.id,
      name: r.name,
      kind: (r.kind === 'equipment' ? 'equipment' : 'room') as 'room' | 'equipment',
      color: r.color,
      active: r.active,
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
      source: h.source,
      sourceKey: h.sourceKey,
      enabled: h.enabled,
    })),
    hrSettings,
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
