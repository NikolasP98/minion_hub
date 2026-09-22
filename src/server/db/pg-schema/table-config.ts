import { pgTable, text, jsonb, timestamp } from 'drizzle-orm/pg-core';

/**
 * Per-org table configuration — one jsonb document per org keyed by table id
 * (`src/lib/tables/registry.ts`): ID-column prefix + per-field overrides.
 * Migration: supabase/migrations/20260922000000_table_config.sql. Org-scoped
 * via withOrgCore (app_ledger + GUC, forced RLS), mirrors crm_settings.
 */
export const appTableConfig = pgTable('app_table_config', {
  orgId: text('org_id').primaryKey(),
  value: jsonb('value').notNull().default({}),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
