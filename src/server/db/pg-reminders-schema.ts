import { pgTable, uuid, text, jsonb, boolean, timestamp, index, uniqueIndex } from 'drizzle-orm/pg-core';

/**
 * Autonomous Reminders Agent (Scheduling R2). Per-org config + an immutable
 * send-log that doubles as the idempotency guard. Same tenancy + RLS model as
 * the sched_* tables (org_id text, withOrgCore, forced RLS via the companion
 * migration at the meta-repo root). Soft reference to sched_bookings only.
 */

/** Per-org reminder agent configuration. Default-OFF: dormant until an admin
 *  enables it and sets a WhatsApp account, so it can never message customers
 *  unexpectedly. */
export const schedReminderConfig = pgTable('sched_reminder_config', {
  orgId: text('org_id').primaryKey(),
  enabled: boolean('enabled').notNull().default(false),
  /** Ordered stages: confirmation (on booking) + time-based pre-appointment.
   *  [{key:'confirmation'},{key:'24h',minutesBefore:1440},{key:'2h',minutesBefore:120}] */
  stages: jsonb('stages')
    .notNull()
    .default([
      { key: 'confirmation' },
      { key: '24h', minutesBefore: 1440 },
      { key: '2h', minutesBefore: 120 },
    ]),
  channel: text('channel').notNull().default('whatsapp'),
  /** Which gateway channel account sends (e.g. the org's WhatsApp account id). */
  accountId: text('account_id'),
  personalize: boolean('personalize').notNull().default(true),
  locale: text('locale').notNull().default('es'),
  fromName: text('from_name'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/** One row per (booking, stage) — audit trail + the dedup guard that guarantees
 *  a stage is sent at most once per booking. */
export const schedReminders = pgTable(
  'sched_reminders',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: text('org_id').notNull(),
    bookingId: uuid('booking_id').notNull(),
    stage: text('stage').notNull(), // 'confirmation' | '24h' | '2h' | …
    channel: text('channel').notNull(),
    recipient: text('recipient'),
    content: text('content'),
    status: text('status').notNull(), // 'sent' | 'failed' | 'skipped'
    messageId: text('message_id'),
    error: text('error'),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    bookingStageUniq: uniqueIndex('sched_reminders_booking_stage_uniq').on(t.orgId, t.bookingId, t.stage),
    orgCreatedIdx: index('sched_reminders_org_created_idx').on(t.orgId, t.createdAt),
    bookingIdx: index('sched_reminders_booking_idx').on(t.bookingId),
  }),
);

export type SchedReminderConfig = typeof schedReminderConfig.$inferSelect;
export type SchedReminder = typeof schedReminders.$inferSelect;

/** A configured reminder stage. */
export interface ReminderStage {
  key: string;
  /** Minutes before startTime (omitted for the booking-time 'confirmation' stage). */
  minutesBefore?: number;
}
