import { pgTable, text, timestamp, index, primaryKey } from 'drizzle-orm/pg-core';

/**
 * Cross-device hub-only "opened" state for feed emails (Supabase PG). One row
 * per (user, Gmail message) the user has opened IN THE HUB — deliberately
 * separate from Gmail's read/unread. Personal data: code-scoped by user_id via
 * getCoreDb() (same pattern as `notes`), no RLS.
 *
 * Migration: supabase/migrations/20260709140000_email_opens.sql
 */
export const emailOpens = pgTable(
  'email_opens',
  {
    userId: text('user_id').notNull(),
    gmailMessageId: text('gmail_message_id').notNull(),
    openedAt: timestamp('opened_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.gmailMessageId] }),
    index('email_opens_user_idx').on(t.userId, t.openedAt),
  ],
);

export type EmailOpenRow = typeof emailOpens.$inferSelect;
