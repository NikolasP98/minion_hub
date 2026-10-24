import { pgTable, text, jsonb, timestamp } from 'drizzle-orm/pg-core';

/**
 * Per-org custom navigation — one jsonb document per org (`NavConfig`,
 * `src/lib/nav/custom-sections.ts`): sections of alias pages + role grants.
 * Migration: supabase/migrations/20261024000000_app_nav_config.sql. Org-scoped
 * via withOrgCore (app_ledger + GUC, forced RLS), mirrors app_table_config.
 */
export const appNavConfig = pgTable('app_nav_config', {
  orgId: text('org_id').primaryKey(),
  value: jsonb('value').notNull().default({}),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
