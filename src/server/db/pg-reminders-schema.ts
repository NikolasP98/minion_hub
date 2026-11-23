import { sql } from 'drizzle-orm';
import {
  pgTable,
  uuid,
  text,
  jsonb,
  boolean,
  timestamp,
  index,
  uniqueIndex,
  integer,
  numeric,
} from 'drizzle-orm/pg-core';

/**
 * Autonomous Reminders Agent (Scheduling R2). Per-org config plus legacy
 * reminder claim/finalization rows used as the local deduplication guard. A
 * terminal row is not a provider-acceptance receipt and does not prove an
 * exactly-once external send. Same tenancy + RLS model as the sched_* tables
 * (org_id text, withOrgCore, forced RLS via the companion SQL migration). The
 * Drizzle declaration omits a relation to avoid a schema import cycle, while
 * the canonical migration enforces booking_id ON DELETE CASCADE.
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
  /** When true, an LLM infers accept/decline from the contact's replies (the
   *  "agent"); when false, the confirmation asks for SÍ/NO and we substring-match. */
  inferConfirmation: boolean('infer_confirmation').notNull().default(false),
  locale: text('locale').notNull().default('es'),
  fromName: text('from_name'),
  /** Spec 139: hours the agent waits for a client's answer after a "no" (1-168). */
  negationWaitHours: integer('negation_wait_hours').notNull().default(24),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/** One row per local (booking, stage, channel, audience) claim. The unique key
 *  prevents a second claim row; delivery ambiguity still requires the later
 *  notification outbox/effect receipt protocol. */
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
    status: text('status').notNull(), // 'sending' | 'sent' | 'failed' | 'skipped'
    messageId: text('message_id'),
    /** Spec 139: the account the reminder was sent with; null = legacy row or the gateway default. */
    accountId: text('account_id'),
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

/** Spec 139: a client's "no" to a reminder opens one case per appointment (per visit when merged). */
export const schedReconfirmCases = pgTable(
  'sched_reconfirm_cases',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: text('org_id').notNull(),
    bookingId: uuid('booking_id').notNull(),
    subjectKey: text('subject_key').notNull(),
    contactId: uuid('contact_id'),
    channel: text('channel').notNull(),
    accountId: text('account_id'),
    recipient: text('recipient').notNull(),
    bookingStartAt: timestamp('booking_start_at', { withTimezone: true }).notNull(),
    agentState: text('agent_state').notNull().default('none'), // none | asking | offered | done
    result: text('result'),
    summary: text('summary'),
    offeredSlots: jsonb('offered_slots').notNull().default([]),
    offerBookingUpdatedAt: timestamp('offer_booking_updated_at', { withTimezone: true }),
    waitUntil: timestamp('wait_until', { withTimezone: true }),
    lastInboundAt: timestamp('last_inbound_at', { withTimezone: true }),
    openedAt: timestamp('opened_at', { withTimezone: true }).notNull().defaultNow(),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    closedBy: uuid('closed_by'),
    closeAction: text('close_action'),
    closeNote: text('close_note'),
  },
  (t) => ({
    openUniq: uniqueIndex('sched_reconfirm_cases_open_uniq')
      .on(t.orgId, t.subjectKey)
      .where(sql`${t.closedAt} is null`),
    bookingIdx: index('sched_reconfirm_cases_booking_idx').on(t.orgId, t.bookingId),
  }),
);

/** Append-only log: classifier verdicts (also the scan's cursor), agent messages, staff actions. */
export const schedReconfirmEvents = pgTable(
  'sched_reconfirm_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: text('org_id').notNull(),
    bookingId: uuid('booking_id').notNull(),
    caseId: uuid('case_id'),
    kind: text('kind').notNull(), // verdict | agent_message | client_message | staff_action | system
    verdict: text('verdict'),
    confidence: numeric('confidence', { precision: 4, scale: 3 }),
    via: text('via'), // keyword | jev
    content: text('content'),
    sendStatus: text('send_status'), // sending | sent | failed (agent_message only)
    step: text('step'),
    messageId: text('message_id'),
    inboundAt: timestamp('inbound_at', { withTimezone: true }),
    inboundMessageId: uuid('inbound_message_id'),
    data: jsonb('data').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    bookingIdx: index('sched_reconfirm_events_booking_idx').on(t.orgId, t.bookingId, t.createdAt),
    caseIdx: index('sched_reconfirm_events_case_idx').on(t.orgId, t.caseId, t.createdAt),
    caseStepUniq: uniqueIndex('sched_reconfirm_events_case_step_uniq')
      .on(t.caseId, t.step)
      .where(sql`${t.kind} = 'agent_message'`),
  }),
);

export type SchedReconfirmCase = typeof schedReconfirmCases.$inferSelect;
export type SchedReconfirmEvent = typeof schedReconfirmEvents.$inferSelect;

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
