import {
  pgTable,
  uuid,
  text,
  jsonb,
  boolean,
  integer,
  date,
  timestamp,
  index,
  uniqueIndex,
  unique,
  primaryKey,
} from 'drizzle-orm/pg-core';

/**
 * Collection points ("doors", spec 041). Mirror of
 * `supabase/migrations/20261025100000_crm_doors.sql` — the migration is canonical
 * (forced RLS + `<table>_org_guc` policies live there; Drizzle does not manage RLS).
 * Booking links are doors of kind `book` but stay in `sched_links`.
 */

/** One public entry point of an org, served at `/d/<slug>` (slug is GLOBALLY unique). */
export const crmDoors = pgTable(
  'crm_doors',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: text('org_id').notNull(),
    /** 'form' | 'faq' | 'offer' (checked in SQL). */
    kind: text('kind').notNull(),
    slug: text('slug').notNull(),
    title: text('title').notNull(),
    description: text('description'),
    /** Default OFF so nothing is published by accident. */
    active: boolean('active').notNull().default(false),
    /** Kind-specific config, validated by the kind module's `configSchema`. */
    config: jsonb('config').notNull().default({}),
    /** S4 follow-up setting `{enabled, delayMinutes, accountId, template}`; form doors only. */
    followUp: jsonb('follow_up'),
    createdBy: uuid('created_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    slugUniq: uniqueIndex('crm_doors_slug_uniq').on(t.slug),
    orgIdx: index('crm_doors_org_idx').on(t.orgId, t.kind),
  }),
);

/** What a visitor sent through a form door. Personal, possibly clinical data. */
export const crmDoorSubmissions = pgTable(
  'crm_door_submissions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: text('org_id').notNull(),
    doorId: uuid('door_id')
      .notNull()
      .references(() => crmDoors.id, { onDelete: 'restrict' }),
    /** Soft ref crm_contacts.id (null when the submission carried no phone/email). */
    contactId: uuid('contact_id'),
    payload: jsonb('payload').notNull(),
    consent: boolean('consent').notNull().default(false),
    /** Snapshot of the consent text the visitor agreed to. */
    consentText: text('consent_text'),
    attribution: jsonb('attribution').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    doorIdx: index('crm_door_submissions_door_idx').on(t.orgId, t.doorId, t.createdAt),
    contactIdx: index('crm_door_submissions_contact_idx').on(t.orgId, t.contactId),
  }),
);

/** One claimed automatic follow-up per (door, contact), ever (S4). */
export const crmDoorFollowups = pgTable(
  'crm_door_followups',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: text('org_id').notNull(),
    doorId: uuid('door_id')
      .notNull()
      .references(() => crmDoors.id, { onDelete: 'restrict' }),
    contactId: uuid('contact_id').notNull(),
    submissionId: uuid('submission_id')
      .notNull()
      .references(() => crmDoorSubmissions.id, { onDelete: 'restrict' }),
    /** 'sending' | 'sent' | 'failed' | 'skipped' (checked in SQL). */
    status: text('status').notNull(),
    reason: text('reason'),
    recipient: text('recipient'),
    content: text('content'),
    messageId: text('message_id'),
    error: text('error'),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    claimUniq: unique('crm_door_followups_org_id_door_id_contact_id_key').on(
      t.orgId,
      t.doorId,
      t.contactId,
    ),
  }),
);

/** Anonymous daily counters. `door_key` = `book:<sched_links.id>` | `door:<crm_doors.id>`. */
export const crmDoorStatsDaily = pgTable(
  'crm_door_stats_daily',
  {
    orgId: text('org_id').notNull(),
    doorKey: text('door_key').notNull(),
    day: date('day').notNull(),
    views: integer('views').notNull().default(0),
    submissions: integer('submissions').notNull().default(0),
    clicks: integer('clicks').notNull().default(0),
  },
  (t) => ({ pk: primaryKey({ columns: [t.orgId, t.doorKey, t.day] }) }),
);

export type CrmDoor = typeof crmDoors.$inferSelect;
