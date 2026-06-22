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
  /** Channels to send on — `[{channel, accountId}]`. Empty falls back to the
   *  legacy single `channel`/`accountId` pair below (back-compat). */
  channels: jsonb('channels').notNull().default([]),
  /** @deprecated legacy single channel — superseded by `channels`. */
  channel: text('channel').notNull().default('whatsapp'),
  /** @deprecated legacy single account — superseded by `channels`. */
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
    /** Audience this row targets: 'client' (the attendee) | 'team' (the staff). */
    recipientRole: text('recipient_role').notNull().default('client'),
    recipient: text('recipient'),
    content: text('content'),
    status: text('status').notNull(), // 'sent' | 'failed' | 'skipped'
    messageId: text('message_id'),
    error: text('error'),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // Dedup key now spans channel + role so a stage can fan out to several
    // channels / audiences, each sent at most once.
    bookingStageUniq: uniqueIndex('sched_reminders_booking_stage_chan_uniq').on(
      t.orgId,
      t.bookingId,
      t.stage,
      t.channel,
      t.recipientRole,
    ),
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
  /** Stage on/off without deleting it. Treated as true when omitted. */
  enabled?: boolean;
  /** Who receives this stage. Defaults to 'client' when omitted. */
  recipients?: 'client' | 'team' | 'both';
}

/** A configured send channel for notifications. */
export interface ReminderChannel {
  channel: string;
  accountId: string | null;
}
