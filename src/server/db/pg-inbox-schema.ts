import { sql } from 'drizzle-orm';
import {
  index,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

/**
 * In-app inbox (spec 2026-10-10-hub-inbox-notifications-reminders, Slice 1).
 * Tenancy: `org_id` nullable (null = global, every signed-in member) enforced
 * by `withOrgCore` (role `app_ledger` + `app.current_org_id` GUC, forced RLS).
 * Policy/grants in the companion migration
 * `supabase/migrations/20261011100000_app_notifications.sql`.
 */
export const appNotifications = pgTable(
  'app_notifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    scope: text('scope').notNull(), // global | org | role | user
    orgId: text('org_id'),
    capability: text('capability'), // role scope: 'module:action'
    profileId: uuid('profile_id'), // user scope
    kind: text('kind').notNull(),
    severity: text('severity').notNull().default('info'), // info | warning | critical
    title: text('title').notNull(),
    body: text('body'),
    href: text('href'),
    subjectType: text('subject_type'),
    subjectId: text('subject_id'),
    dedupeKey: text('dedupe_key'),
    data: jsonb('data').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  },
  (t) => ({
    dedupeUniq: uniqueIndex('app_notifications_dedupe_key_uniq')
      .on(t.dedupeKey)
      .where(sql.raw('dedupe_key is not null')),
    scopeOrgCreatedIdx: index('app_notifications_scope_org_created_idx').on(
      t.scope,
      t.orgId,
      t.createdAt,
    ),
    profileIdx: index('app_notifications_profile_idx')
      .on(t.profileId)
      .where(sql.raw('profile_id is not null')),
    unresolvedIdx: index('app_notifications_unresolved_idx')
      .on(t.resolvedAt)
      .where(sql.raw('resolved_at is null')),
  }),
);
export type AppNotification = typeof appNotifications.$inferSelect;
export type AppNotificationInsert = typeof appNotifications.$inferInsert;

/** Per-user read/dismiss state. Never deletes the notification (I3). */
export const appNotificationReads = pgTable(
  'app_notification_reads',
  {
    profileId: uuid('profile_id').notNull(),
    notificationId: uuid('notification_id')
      .notNull()
      .references(() => appNotifications.id, { onDelete: 'cascade' }),
    readAt: timestamp('read_at', { withTimezone: true }),
    dismissedAt: timestamp('dismissed_at', { withTimezone: true }),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.profileId, t.notificationId] }),
    notificationIdx: index('app_notification_reads_notification_idx').on(t.notificationId),
  }),
);
export type AppNotificationRead = typeof appNotificationReads.$inferSelect;
