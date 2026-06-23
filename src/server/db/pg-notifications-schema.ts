import { pgTable, uuid, text, jsonb, boolean, integer, timestamp, index, uniqueIndex } from 'drizzle-orm/pg-core';

/**
 * Generic event-driven notification rules — Minion's port of ERPNext's
 * Notification doctype. "When X happens to <entity>, message <recipient> over
 * <channel>." Generalizes the scheduling-only reminders agent: that agent is now
 * one special case of this engine (date_offset on sched_bookings.start_time).
 *
 * Triggers (v1): 'insert' (new row), 'update' (any change), 'date_offset' (N
 * minutes before/after a date field). 'field_change' deferred (needs a snapshot
 * table). Delivery reuses the gateway `channels.send` path; dedup + audit via
 * notif_log's unique (rule, entity, trigger_key). org-scoped + forced RLS.
 *
 * Latency: cron-poll (the netcup per-minute tick), not synchronous like ERPNext's
 * in-process doc hook — acceptable for these alerts; a Supabase AFTER-trigger →
 * queue would close the gap if real-time is ever needed.
 */
export const notifRules = pgTable(
  'notif_rules',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: text('org_id').notNull(),
    name: text('name').notNull(),
    enabled: boolean('enabled').notNull().default(true),
    /** Allowlisted in notif.service TABLE_META — e.g. 'support_issues'. */
    triggerTable: text('trigger_table').notNull(),
    /** 'insert' | 'update' | 'date_offset' */
    triggerEvent: text('trigger_event').notNull(),
    /** date_offset: which timestamptz column. */
    dateField: text('date_field'),
    /** date_offset: negative = before, positive = after the date. */
    dateOffsetMins: integer('date_offset_mins'),
    /** Filter array [{field, op, value}] (AND) evaluated against the candidate row. */
    condition: jsonb('condition').notNull().default([]),
    /** Recipients [{type:'field'|'static', value}]. */
    recipients: jsonb('recipients').notNull().default([]),
    channel: text('channel').notNull(), // 'whatsapp' | 'telegram' | 'email'
    accountId: text('account_id'),
    /** Handlebars-lite template; {{field}} interpolated from the row. */
    template: text('template').notNull(),
    /** Sliding-window lower bound for the next tick (insert/update/date_offset). */
    lastRunAt: timestamp('last_run_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ orgIdx: index('notif_rules_org_idx').on(t.orgId) }),
);

/** Immutable send log — audit + idempotency guard. */
export const notifLog = pgTable(
  'notif_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: text('org_id').notNull(),
    ruleId: uuid('rule_id').notNull(),
    entityId: text('entity_id').notNull(),
    triggerKey: text('trigger_key').notNull(),
    channel: text('channel').notNull(),
    recipient: text('recipient'),
    content: text('content'),
    status: text('status').notNull(), // 'sent' | 'failed'
    error: text('error'),
    messageId: text('message_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    dedup: uniqueIndex('notif_log_rule_entity_key_uniq').on(t.ruleId, t.entityId, t.triggerKey),
    orgIdx: index('notif_log_org_idx').on(t.orgId, t.createdAt),
  }),
);

export type NotifRule = typeof notifRules.$inferSelect;
export type NotifLogRow = typeof notifLog.$inferSelect;
