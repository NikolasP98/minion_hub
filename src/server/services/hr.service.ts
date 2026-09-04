/**
 * HR service (spec `2026-09-02-hub-team-hr-module-spec`, S1) — employees,
 * holidays, leave types / allocations / requests. Rules live in
 * `$server/hr/leave-rules` (pure, tested); this file is the DB glue.
 */
import { and, eq, gte, lte, inArray, asc, desc, sql } from 'drizzle-orm';
import { withOrgCore, type CoreTx } from '$server/db/with-org-core';
import type { CoreCtx } from '$server/auth/core-ctx';
import {
  hrEmployees,
  hrHolidays,
  hrLeaveTypes,
  hrLeaveAllocations,
  hrLeaveRequests,
  hrSettings,
  type HrEmployee,
  type HrHoliday,
  type HrLeaveType,
  type HrLeaveAllocation,
  type HrLeaveRequest,
} from '$server/db/pg-hr-schema';
import { schedResources, schedSchedules, schedAvailability } from '$server/db/pg-scheduling-schema';
import {
  leaveDays,
  leaveBalance,
  rangesOverlap,
  weeklyOffDates,
  canTransition,
  BLOCKING_STATUSES,
  type LeaveStatus,
  type LeaveBalance,
} from '$server/hr/leave-rules';

export class HrRuleError extends Error {
  constructor(
    public code:
      | 'employee_inactive'
      | 'invalid_range'
      | 'only_holidays'
      | 'overlap'
      | 'max_days'
      | 'no_balance'
      | 'self_approval'
      | 'bad_transition'
      | 'left_needs_date'
      | 'import_failed'
      | 'not_found',
    message: string,
  ) {
    super(message);
  }
}

// ── Employees ────────────────────────────────────────────────────────────────

export interface EmployeeInput {
  name: string;
  email?: string | null;
  profileId?: string | null;
  partyId?: string | null;
  designation?: string | null;
  department?: string | null;
  employmentType?: string | null;
  joinedOn?: string | null;
}

export type EmployeeRow = HrEmployee & {
  resource: { id: string; active: boolean; color: string | null } | null;
};

export function listEmployees(
  ctx: CoreCtx,
  opts: { includeLeft?: boolean } = {},
): Promise<EmployeeRow[]> {
  return withOrgCore(ctx, async (tx) => {
    const conds = [eq(hrEmployees.orgId, ctx.tenantId)];
    if (!opts.includeLeft) conds.push(eq(hrEmployees.status, 'active'));
    const rows = await tx
      .select({
        employee: hrEmployees,
        resource: {
          id: schedResources.id,
          active: schedResources.active,
          color: schedResources.color,
        },
      })
      .from(hrEmployees)
      .leftJoin(schedResources, eq(schedResources.id, hrEmployees.resourceId))
      .where(and(...conds))
      .orderBy(asc(hrEmployees.name));
    return rows.map((r) => ({ ...r.employee, resource: r.resource?.id ? r.resource : null }));
  });
}

/** Enrol a person: employee row + its bookable resource (seeded Mon–Fri 09–17), one transaction. */
export async function enrolEmployee(ctx: CoreCtx, input: EmployeeInput): Promise<EmployeeRow> {
  return withOrgCore(ctx, async (tx) => {
    // Re-use a resource already bridged to this profile (legacy /scheduling/resources enrolment).
    let resource = input.profileId
      ? (
          await tx
            .select()
            .from(schedResources)
            .where(
              and(
                eq(schedResources.orgId, ctx.tenantId),
                eq(schedResources.profileId, input.profileId),
              ),
            )
            .limit(1)
        )[0]
      : undefined;
    if (!resource) {
      [resource] = await tx
        .insert(schedResources)
        .values({
          orgId: ctx.tenantId,
          name: input.name,
          kind: 'staff',
          profileId: input.profileId ?? null,
          email: input.email ?? null,
        })
        .returning();
      const [sched] = await tx
        .insert(schedSchedules)
        .values({
          orgId: ctx.tenantId,
          resourceId: resource.id,
          timezone: resource.timezone,
          isDefault: true,
        })
        .returning();
      await tx.insert(schedAvailability).values({
        orgId: ctx.tenantId,
        scheduleId: sched.id,
        days: [1, 2, 3, 4, 5],
        startTime: '09:00',
        endTime: '17:00',
        date: null,
      });
    } else if (!resource.active) {
      await tx
        .update(schedResources)
        .set({ active: true, updatedAt: new Date() })
        .where(eq(schedResources.id, resource.id));
    }
    const [emp] = await tx
      .insert(hrEmployees)
      .values({
        orgId: ctx.tenantId,
        name: input.name,
        email: input.email ?? null,
        profileId: input.profileId ?? null,
        partyId: input.partyId ?? null,
        resourceId: resource.id,
        designation: input.designation ?? null,
        department: input.department ?? null,
        employmentType: input.employmentType ?? null,
        joinedOn: input.joinedOn ?? null,
      })
      .returning();
    return { ...emp, resource: { id: resource.id, active: true, color: resource.color } };
  });
}

export async function updateEmployee(
  ctx: CoreCtx,
  id: string,
  patch: Partial<EmployeeInput> & { status?: 'active' | 'left'; leftOn?: string | null },
): Promise<void> {
  await withOrgCore(ctx, async (tx) => {
    const [emp] = await tx
      .select()
      .from(hrEmployees)
      .where(and(eq(hrEmployees.id, id), eq(hrEmployees.orgId, ctx.tenantId)))
      .limit(1);
    if (!emp) throw new HrRuleError('not_found', 'employee not found');
    // hrms validate_status: Left requires relieving_date.
    if (patch.status === 'left' && !(patch.leftOn ?? emp.leftOn))
      throw new HrRuleError('left_needs_date', 'left_on is required to mark an employee as left');
    const set: Partial<typeof hrEmployees.$inferInsert> = { updatedAt: new Date() };
    if (patch.name !== undefined) set.name = patch.name;
    if (patch.email !== undefined) set.email = patch.email;
    if (patch.designation !== undefined) set.designation = patch.designation;
    if (patch.department !== undefined) set.department = patch.department;
    if (patch.employmentType !== undefined) set.employmentType = patch.employmentType;
    if (patch.joinedOn !== undefined) set.joinedOn = patch.joinedOn;
    if (patch.partyId !== undefined) set.partyId = patch.partyId;
    if (patch.status !== undefined) {
      set.status = patch.status;
      set.leftOn = patch.status === 'left' ? (patch.leftOn ?? emp.leftOn) : null;
    }
    await tx.update(hrEmployees).set(set).where(eq(hrEmployees.id, id));
    // The resource follows the employee: left ⇒ not bookable; back to active ⇒ bookable.
    if (patch.status !== undefined && emp.resourceId) {
      await tx
        .update(schedResources)
        .set({ active: patch.status === 'active', updatedAt: new Date() })
        .where(eq(schedResources.id, emp.resourceId));
    }
  });
}

// ── Settings (hr_settings.value) ─────────────────────────────────────────────

export interface HrSettings {
  /** Recurring weekly off (0=Sun…6=Sat) — computed at read time, never materialised. */
  weeklyOff: number[];
  /** ISO-3166 alpha-2 used by the holiday import (Nager.Date). */
  country: string | null;
}

/** Reads the org's HR settings inside the caller's transaction (missing row ⇒ defaults). */
async function readHrSettings(tx: CoreTx, orgId: string): Promise<HrSettings> {
  const [row] = await tx
    .select({ value: hrSettings.value })
    .from(hrSettings)
    .where(eq(hrSettings.orgId, orgId))
    .limit(1);
  const v = (row?.value ?? {}) as Record<string, unknown>;
  const weeklyOff = Array.isArray(v.weeklyOff)
    ? v.weeklyOff.filter((d): d is number => Number.isInteger(d) && d >= 0 && d <= 6)
    : [];
  return { weeklyOff, country: typeof v.country === 'string' ? v.country : null };
}

export function getHrSettings(ctx: CoreCtx): Promise<HrSettings> {
  return withOrgCore(ctx, (tx) => readHrSettings(tx, ctx.tenantId));
}

export function updateHrSettings(ctx: CoreCtx, patch: Partial<HrSettings>): Promise<HrSettings> {
  return withOrgCore(ctx, async (tx) => {
    const cur = await readHrSettings(tx, ctx.tenantId);
    const next: HrSettings = {
      weeklyOff: patch.weeklyOff ?? cur.weeklyOff,
      country: patch.country === undefined ? cur.country : patch.country,
    };
    await tx
      .insert(hrSettings)
      .values({ orgId: ctx.tenantId, value: next })
      .onConflictDoUpdate({
        target: hrSettings.orgId,
        set: { value: next, updatedAt: new Date() },
      });
    return next;
  });
}

// ── Holidays ─────────────────────────────────────────────────────────────────

/** Stored holidays only (enabled or not); weekly offs come from `getHrSettings().weeklyOff`. */
export function listHolidays(ctx: CoreCtx, from?: string, to?: string): Promise<HrHoliday[]> {
  return withOrgCore(ctx, (tx) => {
    const conds = [eq(hrHolidays.orgId, ctx.tenantId)];
    if (from) conds.push(gte(hrHolidays.date, from));
    if (to) conds.push(lte(hrHolidays.date, to));
    return tx
      .select()
      .from(hrHolidays)
      .where(and(...conds))
      .orderBy(asc(hrHolidays.date));
  });
}

/** Manual holiday, upserted by date. */
export async function upsertHoliday(
  ctx: CoreCtx,
  input: { date: string; name: string },
): Promise<HrHoliday> {
  return withOrgCore(ctx, async (tx) => {
    const [row] = await tx
      .insert(hrHolidays)
      .values({ orgId: ctx.tenantId, date: input.date, name: input.name, source: 'manual' })
      .onConflictDoUpdate({
        target: [hrHolidays.orgId, hrHolidays.date],
        set: { name: input.name, enabled: true },
      })
      .returning();
    return row;
  });
}

/** Toggle / rename / move the observed date (e.g. a Thursday holiday taken on Friday). */
export async function updateHoliday(
  ctx: CoreCtx,
  id: string,
  patch: { enabled?: boolean; date?: string; name?: string },
): Promise<HrHoliday> {
  return withOrgCore(ctx, async (tx) => {
    const [row] = await tx
      .update(hrHolidays)
      .set(patch)
      .where(and(eq(hrHolidays.id, id), eq(hrHolidays.orgId, ctx.tenantId)))
      .returning();
    if (!row) throw new HrRuleError('not_found', 'holiday not found');
    return row;
  });
}

export async function deleteHoliday(ctx: CoreCtx, id: string): Promise<void> {
  await withOrgCore(ctx, (tx) =>
    tx.delete(hrHolidays).where(and(eq(hrHolidays.id, id), eq(hrHolidays.orgId, ctx.tenantId))),
  );
}

const NAGER_BASE = 'https://date.nager.at/api/v3';

/**
 * Imports a country's public holidays for one year from Nager.Date (keyless,
 * community-run). Rows are keyed `${country}:${originalDate}` so re-importing
 * never duplicates a holiday the org moved or disabled; a date already taken
 * by a manual holiday is skipped. Nager repeats some dates under different
 * English names (Jueves Santo ×2) — first localName per date wins.
 */
export async function importCountryHolidays(
  ctx: CoreCtx,
  country: string,
  year: number,
): Promise<{ imported: number; total: number }> {
  const res = await fetch(`${NAGER_BASE}/PublicHolidays/${year}/${country}`);
  if (res.status === 404) throw new HrRuleError('not_found', `no holidays for ${country}`);
  if (!res.ok) throw new HrRuleError('import_failed', `Nager.Date ${res.status}`);
  const raw = (await res.json()) as { date?: unknown; localName?: unknown; name?: unknown }[];
  const byDate = new Map<string, string>();
  for (const h of raw) {
    if (typeof h.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(h.date)) continue;
    const name = typeof h.localName === 'string' ? h.localName : String(h.name ?? '');
    if (name && !byDate.has(h.date)) byDate.set(h.date, name);
  }
  // TODO(handoff): a date already held by a manual holiday is skipped silently
  // (unique (org, date)); only the imported/total counts hint at it (proposal #12).
  return withOrgCore(ctx, async (tx) => {
    let imported = 0;
    for (const [date, name] of byDate) {
      const rows = await tx
        .insert(hrHolidays)
        .values({
          orgId: ctx.tenantId,
          date,
          name,
          source: 'country',
          sourceKey: `${country}:${date}`,
        })
        .onConflictDoNothing()
        .returning({ id: hrHolidays.id });
      imported += rows.length;
    }
    await tx
      .insert(hrSettings)
      .values({ orgId: ctx.tenantId, value: { country } })
      .onConflictDoUpdate({
        target: hrSettings.orgId,
        set: { value: sql`${hrSettings.value} || ${JSON.stringify({ country })}::jsonb` },
      });
    return { imported, total: byDate.size };
  });
}

/** Enabled holiday dates in [from, to] ∪ the recurring weekly offs — the ONE non-working-day set. */
async function nonWorkingDates(
  tx: CoreTx,
  orgId: string,
  from: string,
  to: string,
): Promise<Set<string>> {
  const rows = await tx
    .select({ date: hrHolidays.date })
    .from(hrHolidays)
    .where(
      and(
        eq(hrHolidays.orgId, orgId),
        eq(hrHolidays.enabled, true),
        gte(hrHolidays.date, from),
        lte(hrHolidays.date, to),
      ),
    );
  const { weeklyOff } = await readHrSettings(tx, orgId);
  return new Set([...rows.map((r) => r.date), ...weeklyOffDates(from, to, weeklyOff)]);
}

// ── Leave types ──────────────────────────────────────────────────────────────

const DEFAULT_LEAVE_TYPES = [
  { code: 'vacation', name: 'Vacaciones', paid: true },
  { code: 'sick', name: 'Descanso médico', paid: true, allowNegative: true },
  { code: 'unpaid', name: 'Permiso sin goce', paid: false, allowNegative: true },
] as const;

/** Leave types; seeds the clinic defaults on first read for an org. */
export function listLeaveTypes(ctx: CoreCtx): Promise<HrLeaveType[]> {
  return withOrgCore(ctx, async (tx) => {
    const rows = await tx
      .select()
      .from(hrLeaveTypes)
      .where(eq(hrLeaveTypes.orgId, ctx.tenantId))
      .orderBy(asc(hrLeaveTypes.name));
    if (rows.length) return rows;
    await tx
      .insert(hrLeaveTypes)
      .values(DEFAULT_LEAVE_TYPES.map((t) => ({ orgId: ctx.tenantId, ...t })))
      .onConflictDoNothing();
    return tx
      .select()
      .from(hrLeaveTypes)
      .where(eq(hrLeaveTypes.orgId, ctx.tenantId))
      .orderBy(asc(hrLeaveTypes.name));
  });
}

export async function upsertLeaveType(
  ctx: CoreCtx,
  input: {
    code: string;
    name: string;
    paid?: boolean;
    allowNegative?: boolean;
    includeHoliday?: boolean;
    maxDaysPerRequest?: number | null;
    active?: boolean;
  },
): Promise<HrLeaveType> {
  return withOrgCore(ctx, async (tx) => {
    const set = {
      name: input.name,
      paid: input.paid ?? true,
      allowNegative: input.allowNegative ?? false,
      includeHoliday: input.includeHoliday ?? false,
      maxDaysPerRequest: input.maxDaysPerRequest ?? null,
      active: input.active ?? true,
    };
    const [row] = await tx
      .insert(hrLeaveTypes)
      .values({ orgId: ctx.tenantId, code: input.code, ...set })
      .onConflictDoUpdate({ target: [hrLeaveTypes.orgId, hrLeaveTypes.code], set })
      .returning();
    return row;
  });
}

// ── Allocations ──────────────────────────────────────────────────────────────

export function listAllocations(ctx: CoreCtx, employeeId?: string): Promise<HrLeaveAllocation[]> {
  return withOrgCore(ctx, (tx) => {
    const conds = [eq(hrLeaveAllocations.orgId, ctx.tenantId)];
    if (employeeId) conds.push(eq(hrLeaveAllocations.employeeId, employeeId));
    return tx
      .select()
      .from(hrLeaveAllocations)
      .where(and(...conds))
      .orderBy(desc(hrLeaveAllocations.periodStart));
  });
}

export async function upsertAllocation(
  ctx: CoreCtx,
  input: {
    id?: string;
    employeeId: string;
    leaveTypeId: string;
    periodStart: string;
    periodEnd: string;
    days: number;
  },
): Promise<HrLeaveAllocation> {
  return withOrgCore(ctx, async (tx) => {
    if (input.id) {
      const [row] = await tx
        .update(hrLeaveAllocations)
        .set({
          leaveTypeId: input.leaveTypeId,
          periodStart: input.periodStart,
          periodEnd: input.periodEnd,
          days: String(input.days),
        })
        .where(and(eq(hrLeaveAllocations.id, input.id), eq(hrLeaveAllocations.orgId, ctx.tenantId)))
        .returning();
      if (!row) throw new HrRuleError('not_found', 'allocation not found');
      return row;
    }
    const [row] = await tx
      .insert(hrLeaveAllocations)
      .values({
        orgId: ctx.tenantId,
        employeeId: input.employeeId,
        leaveTypeId: input.leaveTypeId,
        periodStart: input.periodStart,
        periodEnd: input.periodEnd,
        days: String(input.days),
      })
      .returning();
    return row;
  });
}

export async function deleteAllocation(ctx: CoreCtx, id: string): Promise<void> {
  await withOrgCore(ctx, (tx) =>
    tx
      .delete(hrLeaveAllocations)
      .where(and(eq(hrLeaveAllocations.id, id), eq(hrLeaveAllocations.orgId, ctx.tenantId))),
  );
}

// ── Leave requests ───────────────────────────────────────────────────────────

async function balanceFor(
  tx: CoreTx,
  orgId: string,
  employeeId: string,
  leaveTypeId: string,
  on: string,
): Promise<LeaveBalance> {
  const [allocations, requests] = await Promise.all([
    tx
      .select()
      .from(hrLeaveAllocations)
      .where(
        and(
          eq(hrLeaveAllocations.orgId, orgId),
          eq(hrLeaveAllocations.employeeId, employeeId),
          eq(hrLeaveAllocations.leaveTypeId, leaveTypeId),
        ),
      ),
    tx
      .select()
      .from(hrLeaveRequests)
      .where(
        and(
          eq(hrLeaveRequests.orgId, orgId),
          eq(hrLeaveRequests.employeeId, employeeId),
          eq(hrLeaveRequests.leaveTypeId, leaveTypeId),
        ),
      ),
  ]);
  return leaveBalance({
    allocations: allocations.map((a) => ({
      periodStart: a.periodStart,
      periodEnd: a.periodEnd,
      days: Number(a.days),
    })),
    requests: requests.map((r) => ({
      from: r.fromDate,
      to: r.toDate,
      days: Number(r.days),
      status: r.status,
    })),
    on,
  });
}

export function getLeaveBalance(
  ctx: CoreCtx,
  employeeId: string,
  leaveTypeId: string,
  on: string,
): Promise<LeaveBalance> {
  return withOrgCore(ctx, (tx) => balanceFor(tx, ctx.tenantId, employeeId, leaveTypeId, on));
}

export function listLeaveRequests(
  ctx: CoreCtx,
  opts: { employeeId?: string; status?: LeaveStatus[]; from?: string; to?: string } = {},
): Promise<HrLeaveRequest[]> {
  return withOrgCore(ctx, (tx) => {
    const conds = [eq(hrLeaveRequests.orgId, ctx.tenantId)];
    if (opts.employeeId) conds.push(eq(hrLeaveRequests.employeeId, opts.employeeId));
    if (opts.status?.length) conds.push(inArray(hrLeaveRequests.status, opts.status));
    if (opts.from) conds.push(gte(hrLeaveRequests.toDate, opts.from));
    if (opts.to) conds.push(lte(hrLeaveRequests.fromDate, opts.to));
    return tx
      .select()
      .from(hrLeaveRequests)
      .where(and(...conds))
      .orderBy(desc(hrLeaveRequests.fromDate));
  });
}

export interface LeaveRequestInput {
  employeeId: string;
  leaveTypeId: string;
  fromDate: string;
  toDate: string;
  halfDay?: boolean;
  reason?: string | null;
}

/** hrms Leave Application `validate()`: active employee, dates, holidays, overlap, max days, balance. */
export async function createLeaveRequest(
  ctx: CoreCtx,
  input: LeaveRequestInput,
): Promise<HrLeaveRequest> {
  return withOrgCore(ctx, async (tx) => {
    const [emp] = await tx
      .select()
      .from(hrEmployees)
      .where(and(eq(hrEmployees.id, input.employeeId), eq(hrEmployees.orgId, ctx.tenantId)))
      .limit(1);
    if (!emp || emp.status !== 'active')
      throw new HrRuleError('employee_inactive', 'employee is not active');
    const [type] = await tx
      .select()
      .from(hrLeaveTypes)
      .where(and(eq(hrLeaveTypes.id, input.leaveTypeId), eq(hrLeaveTypes.orgId, ctx.tenantId)))
      .limit(1);
    if (!type) throw new HrRuleError('not_found', 'leave type not found');
    if (input.toDate < input.fromDate)
      throw new HrRuleError('invalid_range', 'to_date is before from_date');

    const holidays = await nonWorkingDates(tx, ctx.tenantId, input.fromDate, input.toDate);
    const days = leaveDays({
      from: input.fromDate,
      to: input.toDate,
      halfDay: input.halfDay,
      holidays,
      includeHoliday: type.includeHoliday,
    });
    if (days <= 0) throw new HrRuleError('only_holidays', 'the requested days are all holidays');
    if (type.maxDaysPerRequest != null && days > type.maxDaysPerRequest)
      throw new HrRuleError('max_days', `at most ${type.maxDaysPerRequest} days per request`);

    const existing = await tx
      .select({
        fromDate: hrLeaveRequests.fromDate,
        toDate: hrLeaveRequests.toDate,
        status: hrLeaveRequests.status,
      })
      .from(hrLeaveRequests)
      .where(
        and(
          eq(hrLeaveRequests.orgId, ctx.tenantId),
          eq(hrLeaveRequests.employeeId, input.employeeId),
          lte(hrLeaveRequests.fromDate, input.toDate),
          gte(hrLeaveRequests.toDate, input.fromDate),
        ),
      );
    if (
      existing.some(
        (r) =>
          BLOCKING_STATUSES.has(r.status) &&
          rangesOverlap(
            { from: r.fromDate, to: r.toDate },
            { from: input.fromDate, to: input.toDate },
          ),
      )
    )
      throw new HrRuleError('overlap', 'overlaps another pending or approved request');

    if (!type.allowNegative) {
      const bal = await balanceFor(
        tx,
        ctx.tenantId,
        input.employeeId,
        input.leaveTypeId,
        input.fromDate,
      );
      if (bal.available < days)
        throw new HrRuleError('no_balance', `balance ${bal.available} < ${days} days`);
    }

    const [row] = await tx
      .insert(hrLeaveRequests)
      .values({
        orgId: ctx.tenantId,
        employeeId: input.employeeId,
        leaveTypeId: input.leaveTypeId,
        fromDate: input.fromDate,
        toDate: input.toDate,
        halfDay: input.halfDay ?? false,
        days: String(days),
        reason: input.reason ?? null,
        status: 'pending',
      })
      .returning();
    return row;
  });
}

/** Approve / reject / cancel. An approver never decides their own request (hrms prevent_self_leave_approval). */
export async function decideLeaveRequest(
  ctx: CoreCtx,
  id: string,
  status: Exclude<LeaveStatus, 'pending'>,
): Promise<HrLeaveRequest> {
  return withOrgCore(ctx, async (tx) => {
    const [row] = await tx
      .select({ req: hrLeaveRequests, profileId: hrEmployees.profileId })
      .from(hrLeaveRequests)
      .innerJoin(hrEmployees, eq(hrEmployees.id, hrLeaveRequests.employeeId))
      .where(and(eq(hrLeaveRequests.id, id), eq(hrLeaveRequests.orgId, ctx.tenantId)))
      .limit(1);
    if (!row) throw new HrRuleError('not_found', 'request not found');
    if (!canTransition(row.req.status as LeaveStatus, status))
      throw new HrRuleError('bad_transition', `${row.req.status} → ${status}`);
    if (status !== 'cancelled' && ctx.profileId && row.profileId === ctx.profileId)
      throw new HrRuleError('self_approval', 'cannot decide your own request');
    const [updated] = await tx
      .update(hrLeaveRequests)
      .set({ status, decidedBy: ctx.profileId ?? null, decidedAt: new Date() })
      .where(eq(hrLeaveRequests.id, id))
      .returning();
    return updated;
  });
}

// ── Slot-engine bridge ───────────────────────────────────────────────────────

/**
 * Day-off overrides for the slot engine: org holidays for every resource, plus
 * approved leave days for each resource's employee. An override with an empty
 * range replaces that date's weekly hours (cal.diy semantics in `slots.ts`).
 */
export async function loadDayOffOverrides(
  tx: CoreTx,
  orgId: string,
  resourceIds: string[],
  from: string,
  to: string,
): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>(resourceIds.map((id) => [id, []]));
  if (!resourceIds.length) return out;
  const holidays = [...(await nonWorkingDates(tx, orgId, from, to))];
  for (const id of resourceIds) out.get(id)!.push(...holidays);
  const leaves = await tx
    .select({
      resourceId: hrEmployees.resourceId,
      fromDate: hrLeaveRequests.fromDate,
      toDate: hrLeaveRequests.toDate,
    })
    .from(hrLeaveRequests)
    .innerJoin(hrEmployees, eq(hrEmployees.id, hrLeaveRequests.employeeId))
    .where(
      and(
        eq(hrLeaveRequests.orgId, orgId),
        eq(hrLeaveRequests.status, 'approved'),
        inArray(hrEmployees.resourceId, resourceIds),
        lte(hrLeaveRequests.fromDate, to),
        gte(hrLeaveRequests.toDate, from),
      ),
    );
  for (const l of leaves) {
    if (!l.resourceId) continue;
    const start = l.fromDate < from ? from : l.fromDate;
    const end = l.toDate > to ? to : l.toDate;
    const cur = new Date(`${start}T00:00:00Z`);
    for (; cur.toISOString().slice(0, 10) <= end; cur.setUTCDate(cur.getUTCDate() + 1))
      out.get(l.resourceId)!.push(cur.toISOString().slice(0, 10));
  }
  return out;
}
