import { pgTable, text, bigint, timestamp, primaryKey } from 'drizzle-orm/pg-core';

/**
 * Naming-series counters — Minion's port of ERPNext's `tabSeries` (human IDs
 * like SO-2026-00001, TKT-2026-00042). One row per (org, evaluated prefix); the
 * counter key is the RENDERED prefix (e.g. 'SO-2026-'), so a `.YYYY.` template
 * resets the counter automatically each year — exactly like Frappe.
 *
 * Concurrency: incremented via a single atomic
 * `INSERT … ON CONFLICT (org_id, prefix) DO UPDATE SET n = n+1 RETURNING n`
 * (naming-series.ts) — one statement, no SELECT-FOR-UPDATE round trip. Postgres
 * locks the target row for the upsert, so concurrent inserts can't collide.
 * org-scoped via withOrgCore (app_ledger + GUC, forced RLS).
 */
export const namingSeriesCounters = pgTable(
  'naming_series_counters',
  {
    orgId: text('org_id').notNull(),
    prefix: text('prefix').notNull(), // the EVALUATED prefix, e.g. 'SO-2026-'
    n: bigint('n', { mode: 'number' }).notNull().default(0),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ pk: primaryKey({ columns: [t.orgId, t.prefix] }) }),
);

export type NamingSeriesCounter = typeof namingSeriesCounters.$inferSelect;
