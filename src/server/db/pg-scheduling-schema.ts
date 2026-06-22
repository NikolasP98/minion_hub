import {
  pgTable,
  uuid,
  text,
  jsonb,
  boolean,
  integer,
  timestamp,
  index,
  uniqueIndex,
  primaryKey,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

// Partial-index predicate `profile_id is not null` for the resource uniqueIndex.
function sqlNotNull(col: string) {
  return sql.raw(`${col} is not null`);
}

/**
 * Hub-native Scheduling — a faithful port of cal.diy's scheduling primitives
 * (event types, availability schedules, slots, bookings) into the hub's
 * Drizzle/Postgres stack. Mirrors the CRM + Finances modules exactly:
 *
 *   Tenancy: `org_id text` (== messages.org_id / crm_* / fin_*), enforced by
 *   `withOrgCore` (role `app_ledger` + `app.current_org_id` GUC, forced RLS).
 *   Policies/grants live in the hand-written companion migration
 *   `supabase/migrations/<ts>_scheduling.sql` at the meta-repo root — Drizzle
 *   never manages roles/policies, and we never `db:push` the core DB.
 *
 * Cross-module bridges (soft references, no cross-concern FK/cascade):
 *   - sched_event_types.product_id  → fin_products.id   (procedure → revenue)
 *   - sched_bookings.crm_contact_id → crm_contacts.id   (appointment → customer)
 *
 * Day-of-week convention follows JS `Date.getDay()` / cal.diy: 0=Sun … 6=Sat.
 * Wall-clock times (`start_time`/`end_time` on availability) are 'HH:MM' strings
 * interpreted in the owning schedule's timezone; the slot engine converts to
 * UTC instants. Booking start/end ARE absolute UTC `timestamptz`.
 */

/** A bookable resource. v1 = staff (`kind='staff'`); room/equipment reserved. */
export const schedResources = pgTable(
  'sched_resources',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: text('org_id').notNull(),
    kind: text('kind').notNull().default('staff'), // 'staff' | 'room' | 'equipment'
    /** Soft bridge to a hub user (profiles.id). Null for non-human resources. */
    profileId: uuid('profile_id'),
    name: text('name').notNull(),
    email: text('email'),
    timezone: text('timezone').notNull().default('America/Lima'),
    color: text('color'),
    active: boolean('active').notNull().default(true),
    metadata: jsonb('metadata').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    orgIdx: index('sched_resources_org_idx').on(t.orgId),
    profileUniq: uniqueIndex('sched_resources_org_profile_uniq')
      .on(t.orgId, t.profileId)
      .where(sqlNotNull('profile_id')),
  }),
);

/** A named availability container owned by a resource (cal.diy `Schedule`). */
export const schedSchedules = pgTable(
  'sched_schedules',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: text('org_id').notNull(),
    resourceId: uuid('resource_id')
      .notNull()
      .references(() => schedResources.id, { onDelete: 'cascade' }),
    name: text('name').notNull().default('Working hours'),
    timezone: text('timezone').notNull().default('America/Lima'),
    isDefault: boolean('is_default').notNull().default(true),
    metadata: jsonb('metadata').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    resourceIdx: index('sched_schedules_resource_idx').on(t.resourceId),
    orgIdx: index('sched_schedules_org_idx').on(t.orgId),
  }),
);

/**
 * Working-hours rows (cal.diy `Availability`). A row with `date = null` is a
 * weekly-recurring rule for the given `days`; a row with `date` set is a
 * single-date OVERRIDE that replaces that date's weekly hours (an empty range
 * — startTime == endTime — marks the date as a day off).
 */
export const schedAvailability = pgTable(
  'sched_availability',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: text('org_id').notNull(),
    scheduleId: uuid('schedule_id')
      .notNull()
      .references(() => schedSchedules.id, { onDelete: 'cascade' }),
    days: integer('days').array().notNull().default([]), // 0=Sun … 6=Sat
    startTime: text('start_time').notNull(), // 'HH:MM'
    endTime: text('end_time').notNull(), // 'HH:MM'
    date: text('date'), // 'YYYY-MM-DD' override; null = weekly recurring
    metadata: jsonb('metadata').notNull().default({}),
  },
  (t) => ({
    scheduleIdx: index('sched_availability_schedule_idx').on(t.scheduleId),
    dateIdx: index('sched_availability_schedule_date_idx').on(t.scheduleId, t.date),
  }),
);

/** A bookable appointment type (cal.diy `EventType`). */
export const schedEventTypes = pgTable(
  'sched_event_types',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: text('org_id').notNull(),
    slug: text('slug').notNull(),
    title: text('title').notNull(),
    description: text('description'),
    length: integer('length').notNull(), // minutes
    slotInterval: integer('slot_interval'), // null = step by length
    beforeBuffer: integer('before_buffer').notNull().default(0),
    afterBuffer: integer('after_buffer').notNull().default(0),
    minimumBookingNotice: integer('minimum_booking_notice').notNull().default(120),
    periodType: text('period_type').notNull().default('rolling'), // 'rolling' | 'unlimited'
    periodDays: integer('period_days'), // rolling window in days
    schedulingType: text('scheduling_type'), // null (single) | 'round_robin' | 'collective'
    /** When true, slots must also fall inside this service's own weekly windows
     *  (`scheduleRules`), intersected with the assigned team's availability.
     *  When false, the service inherits the assigned team's availability only. */
    useCustomSchedule: boolean('use_custom_schedule').notNull().default(false),
    /** Weekly windows for the service when `useCustomSchedule`: array of
     *  `{ days:number[], startTime:'HH:MM', endTime:'HH:MM' }` (evaluated in each
     *  assigned resource's timezone). */
    scheduleRules: jsonb('schedule_rules').notNull().default([]),
    requiresConfirmation: boolean('requires_confirmation').notNull().default(false),
    public: boolean('public').notNull().default(true),
    color: text('color'),
    /** Soft bridge to fin_products (procedure → revenue). */
    productId: uuid('product_id'),
    active: boolean('active').notNull().default(true),
    metadata: jsonb('metadata').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    slugUniq: uniqueIndex('sched_event_types_org_slug_uniq').on(t.orgId, t.slug),
    orgIdx: index('sched_event_types_org_idx').on(t.orgId),
  }),
);

/** M:N — which resources can fulfill an event type (round-robin / collective). */
export const schedEventTypeResources = pgTable(
  'sched_event_type_resources',
  {
    orgId: text('org_id').notNull(),
    eventTypeId: uuid('event_type_id')
      .notNull()
      .references(() => schedEventTypes.id, { onDelete: 'cascade' }),
    resourceId: uuid('resource_id')
      .notNull()
      .references(() => schedResources.id, { onDelete: 'cascade' }),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.eventTypeId, t.resourceId] }),
    resourceIdx: index('sched_etr_resource_idx').on(t.resourceId),
  }),
);

/** An appointment (cal.diy `Booking`). */
export const schedBookings = pgTable(
  'sched_bookings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: text('org_id').notNull(),
    uid: text('uid').notNull(), // public booking ref (idempotency + reschedule key)
    eventTypeId: uuid('event_type_id')
      .notNull()
      .references(() => schedEventTypes.id, { onDelete: 'restrict' }),
    resourceId: uuid('resource_id')
      .notNull()
      .references(() => schedResources.id, { onDelete: 'restrict' }),
    startTime: timestamp('start_time', { withTimezone: true }).notNull(),
    endTime: timestamp('end_time', { withTimezone: true }).notNull(),
    // accepted | pending | cancelled | rejected | completed | no_show
    status: text('status').notNull().default('accepted'),
    title: text('title'),
    notes: text('notes'),
    attendeeName: text('attendee_name'),
    attendeeEmail: text('attendee_email'),
    attendeePhone: text('attendee_phone'),
    /** Soft bridge to crm_contacts (appointment → customer). */
    crmContactId: uuid('crm_contact_id'),
    /** Snapshot of the event type's product at booking time. */
    productId: uuid('product_id'),
    source: text('source').notNull().default('internal'), // 'public_link' | 'internal' | 'import'
    rescheduledFromId: uuid('rescheduled_from_id'),
    metadata: jsonb('metadata').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uidUniq: uniqueIndex('sched_bookings_org_uid_uniq').on(t.orgId, t.uid),
    orgStartIdx: index('sched_bookings_org_start_idx').on(t.orgId, t.startTime),
    resourceStartIdx: index('sched_bookings_resource_start_idx').on(t.resourceId, t.startTime),
    // Covers the conflict/busy-interval probe (loadBusyInTx): filters by
    // resource_id + status, ranges on start_time — see scheduling-bookings.service.ts.
    resourceStatusStartIdx: index('sched_bookings_resource_status_start_idx').on(
      t.resourceId,
      t.status,
      t.startTime,
    ),
    statusIdx: index('sched_bookings_org_status_idx').on(t.orgId, t.status),
    crmIdx: index('sched_bookings_crm_idx').on(t.crmContactId),
  }),
);

/** A shareable scheduling link aggregating one or more event types. */
export const schedLinks = pgTable(
  'sched_links',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: text('org_id').notNull(),
    slug: text('slug').notNull(),
    title: text('title').notNull(),
    description: text('description'),
    eventTypeIds: uuid('event_type_ids').array().notNull().default([]),
    resourceId: uuid('resource_id'), // optional pin to a person
    active: boolean('active').notNull().default(true),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    metadata: jsonb('metadata').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    slugUniq: uniqueIndex('sched_links_org_slug_uniq').on(t.orgId, t.slug),
    orgIdx: index('sched_links_org_idx').on(t.orgId),
  }),
);

export type SchedResource = typeof schedResources.$inferSelect;
export type SchedSchedule = typeof schedSchedules.$inferSelect;
export type SchedAvailability = typeof schedAvailability.$inferSelect;
export type SchedEventType = typeof schedEventTypes.$inferSelect;
export type SchedEventTypeResource = typeof schedEventTypeResources.$inferSelect;
export type SchedBooking = typeof schedBookings.$inferSelect;
export type SchedLink = typeof schedLinks.$inferSelect;
