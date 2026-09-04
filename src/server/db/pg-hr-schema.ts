/**
 * HR module (spec `2026-09-02-hub-team-hr-module-spec`, S1). Modeled on
 * frappe/hrms: Employee, Holiday List (weekly offs materialised as rows),
 * Leave Type / Allocation / Application. Migration: hub
 * `supabase/migrations/20260903000000_hr_module.sql`.
 *
 * `profile_id` has NO FK — `profiles` is prod-only (no CREATE in the monorepo),
 * so the service enforces it. `resource_id` → `sched_resources` is the bridge
 * the slot engine reads (approved leave = day-off override for that resource).
 */
import {
  pgTable,
  uuid,
  text,
  boolean,
  integer,
  numeric,
  date,
  jsonb,
  timestamp,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { schedResources } from './pg-scheduling-schema';

function sqlNotNull(col: string) {
  return sql.raw(`${col} is not null`);
}

export const hrEmployees = pgTable(
  'hr_employees',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: text('org_id').notNull(),
    /** Hub login (profiles.id); null for staff without an account. */
    profileId: uuid('profile_id'),
    /** Party spine (person facet); null until reconciled. */
    partyId: uuid('party_id'),
    /** Bookable resource; created together with the employee. */
    resourceId: uuid('resource_id').references(() => schedResources.id, { onDelete: 'set null' }),
    name: text('name').notNull(),
    email: text('email'),
    designation: text('designation'),
    department: text('department'),
    /** hrms employment_type: full_time | part_time | contract | intern. */
    employmentType: text('employment_type'),
    status: text('status').notNull().default('active'), // 'active' | 'left'
    joinedOn: date('joined_on'),
    leftOn: date('left_on'),
    metadata: jsonb('metadata').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    orgIdx: index('hr_employees_org_idx').on(t.orgId),
    profileUniq: uniqueIndex('hr_employees_org_profile_uniq')
      .on(t.orgId, t.profileId)
      .where(sqlNotNull('profile_id')),
    resourceUniq: uniqueIndex('hr_employees_org_resource_uniq')
      .on(t.orgId, t.resourceId)
      .where(sqlNotNull('resource_id')),
  }),
);

/** Org holiday list. `weeklyOff` rows are materialised weekly offs (hrms `get_weekly_off_dates`). */
export const hrHolidays = pgTable(
  'hr_holidays',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: text('org_id').notNull(),
    date: date('date').notNull(),
    name: text('name').notNull(),
    /** Legacy (always false): weekly offs are a rule in `hr_settings` — TODO(handoff): drop column (proposal #16). */
    weeklyOff: boolean('weekly_off').notNull().default(false),
    /** 'manual' | 'country' (Nager.Date import) — imported rows are toggled, not retyped. */
    source: text('source').notNull().default('manual'),
    /** `${country}:${originalDate}` for imports so a re-import never duplicates a moved holiday. */
    sourceKey: text('source_key'),
    enabled: boolean('enabled').notNull().default(true),
  },
  (t) => ({
    dateUniq: uniqueIndex('hr_holidays_org_date_uniq').on(t.orgId, t.date),
  }),
);

/** One jsonb row per org: `{ weeklyOff: number[] (0=Sun…6=Sat), country: 'PE' }`. Mirrors crm_settings. */
export const hrSettings = pgTable('hr_settings', {
  orgId: text('org_id').primaryKey(),
  value: jsonb('value').notNull().default({}),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const hrLeaveTypes = pgTable(
  'hr_leave_types',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: text('org_id').notNull(),
    code: text('code').notNull(), // 'vacation' | 'sick' | 'unpaid' | custom
    name: text('name').notNull(),
    paid: boolean('paid').notNull().default(true), // ¬ hrms is_lwp
    allowNegative: boolean('allow_negative').notNull().default(false),
    includeHoliday: boolean('include_holiday').notNull().default(false),
    maxDaysPerRequest: integer('max_days_per_request'),
    active: boolean('active').notNull().default(true),
  },
  (t) => ({
    codeUniq: uniqueIndex('hr_leave_types_org_code_uniq').on(t.orgId, t.code),
  }),
);

export const hrLeaveAllocations = pgTable(
  'hr_leave_allocations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: text('org_id').notNull(),
    employeeId: uuid('employee_id')
      .notNull()
      .references(() => hrEmployees.id, { onDelete: 'cascade' }),
    leaveTypeId: uuid('leave_type_id')
      .notNull()
      .references(() => hrLeaveTypes.id, { onDelete: 'cascade' }),
    periodStart: date('period_start').notNull(),
    periodEnd: date('period_end').notNull(),
    days: numeric('days').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    employeeIdx: index('hr_leave_allocations_employee_idx').on(t.employeeId),
  }),
);

export const hrLeaveRequests = pgTable(
  'hr_leave_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: text('org_id').notNull(),
    employeeId: uuid('employee_id')
      .notNull()
      .references(() => hrEmployees.id, { onDelete: 'cascade' }),
    leaveTypeId: uuid('leave_type_id')
      .notNull()
      .references(() => hrLeaveTypes.id),
    fromDate: date('from_date').notNull(),
    toDate: date('to_date').notNull(),
    halfDay: boolean('half_day').notNull().default(false),
    /** Counted days (holidays/weekly offs excluded unless the type includes them). */
    days: numeric('days').notNull(),
    reason: text('reason'),
    status: text('status').notNull().default('pending'), // pending|approved|rejected|cancelled
    decidedBy: uuid('decided_by'),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    employeeIdx: index('hr_leave_requests_employee_idx').on(t.employeeId, t.fromDate),
    orgStatusIdx: index('hr_leave_requests_org_status_idx').on(t.orgId, t.status),
  }),
);

export type HrEmployee = typeof hrEmployees.$inferSelect;
export type HrHoliday = typeof hrHolidays.$inferSelect;
export type HrLeaveType = typeof hrLeaveTypes.$inferSelect;
export type HrLeaveAllocation = typeof hrLeaveAllocations.$inferSelect;
export type HrLeaveRequest = typeof hrLeaveRequests.$inferSelect;
