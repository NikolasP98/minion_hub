import { pgTable, text, integer, timestamp, uuid, index, unique } from 'drizzle-orm/pg-core';

/**
 * Email ledger (Supabase Postgres, org-scoped via RLS). A privacy-minded record
 * of each PROCESSED email — the auto-labeler's summary + applied labels + the
 * sender DOMAIN + subject. NEVER the body/snippet/attachments. Written by the
 * gateway over the server-token channel (/api/gateway/email-ledger), read on
 * /channels/gmail, retention-purged via /api/email-ledger/tick.
 *
 * Migration: supabase/migrations/20260709133000_email_ledger.sql
 */
export const emailLedger = pgTable(
  'email_ledger',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: text('org_id').notNull(), // RLS column
    userId: text('user_id'), // mailbox owner (erasure scope)
    mailbox: text('mailbox').notNull(), // watched account address
    gmailMessageId: text('gmail_message_id').notNull(),
    fromDomain: text('from_domain'), // sender domain only (data-min)
    subject: text('subject'),
    summary: text('summary'), // AI one-liner (derived)
    labels: text('labels').array().notNull().default([]),
    processedAt: timestamp('processed_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }), // retention horizon
  },
  (t) => [
    index('email_ledger_org_processed_idx').on(t.orgId, t.processedAt),
    index('email_ledger_expires_idx').on(t.expiresAt),
    unique('email_ledger_mailbox_msg_uq').on(t.mailbox, t.gmailMessageId),
  ],
);

export type EmailLedgerRow = typeof emailLedger.$inferSelect;
export type NewEmailLedgerRow = typeof emailLedger.$inferInsert;

/** Per-org retention config for the ledger (days before the purge tick deletes). */
export const emailLedgerSettings = pgTable('email_ledger_settings', {
  orgId: text('org_id').primaryKey(),
  retentionDays: integer('retention_days').notNull().default(180),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type EmailLedgerSettingsRow = typeof emailLedgerSettings.$inferSelect;
