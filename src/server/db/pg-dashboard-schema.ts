import { pgTable, text, jsonb, timestamp } from 'drizzle-orm/pg-core';

/**
 * Per-org DEFAULT dashboard layouts — the arrangement an admin pins for every
 * user who hasn't customized their own. One row per (org, dashboard id).
 *
 * Layout resolution (client, in EditableGrid): personal layout (localStorage)
 * → this org default → the code-defined defaults. So a user's own edits always
 * win; the admin default only fills in for users who never touched it.
 *
 * `layout` is the GridLayout blob `{ order: string[], span: Record<id,{w,h}> }`.
 * Tenancy: `org_id text` enforced by withOrgCore (role app_ledger +
 * app.current_org_id GUC, forced RLS). Policy/grants in the companion migration
 * `supabase/migrations/<ts>_dashboard_layouts.sql` at the meta-repo root.
 *
 * ponytail: per-USER layouts stay in localStorage (per-browser, zero server
 * cost) — only the shared admin default needs a row. Move user layouts to
 * user_preferences if cross-device sync is ever needed.
 */
export const dashboardLayouts = pgTable('dashboard_layouts', {
  orgId: text('org_id').notNull(),
  dashboardId: text('dashboard_id').notNull(),
  layout: jsonb('layout').notNull().default({}),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type DashboardLayoutRow = typeof dashboardLayouts.$inferSelect;
