import { index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

/**
 * App changelog (spec 2026-10-10-hub-inbox-notifications-reminders, Slice 3).
 * Global, no org dimension — see the companion migration
 * `supabase/migrations/20261011110000_app_releases.sql`.
 */
export const appReleases = pgTable(
  'app_releases',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    version: text('version').notNull(),
    releasedAt: timestamp('released_at', { withTimezone: true }).notNull(),
    sections: jsonb('sections').notNull().default({}),
    prs: jsonb('prs').notNull().default([]),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    versionUniq: uniqueIndex('app_releases_version_key').on(t.version),
    releasedAtIdx: index('app_releases_released_at_idx').on(t.releasedAt),
  }),
);
export type AppRelease = typeof appReleases.$inferSelect;
export type AppReleaseInsert = typeof appReleases.$inferInsert;
