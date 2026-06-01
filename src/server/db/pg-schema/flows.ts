import { pgTable, text, boolean, bigint, integer, index } from 'drizzle-orm/pg-core';

/**
 * Flows live in Supabase Postgres (the relational-core DB), NOT Turso.
 * Column names mirror the legacy SQLite `flows` table 1:1 so the data migration
 * and the route handlers stay mechanical. Timestamps are epoch-ms stored as
 * bigint with `mode: 'number'` so the same numbers flow through unchanged.
 *
 * Visibility is ORG-SCOPED (by tenant_id): every member of an organization sees
 * the org's flows, including plugin-seeded automations (alert-watcher, weekly-recon).
 * `user_id` is kept for provenance only — it no longer gates visibility.
 */
export const flows = pgTable('flows', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  nodes: text('nodes').notNull().default('[]'), // JSON string of FlowNode[]
  edges: text('edges').notNull().default('[]'), // JSON string of FlowEdge[]
  userId: text('user_id'), // creator (provenance) — null for legacy/shared
  tenantId: text('tenant_id'), // org scope (cross-DB ref to Turso organization.id)
  createdAt: bigint('created_at', { mode: 'number' }).notNull(),
  updatedAt: bigint('updated_at', { mode: 'number' }).notNull(),
  active: boolean('active').notNull().default(false),
  config: text('config').notNull().default('{}'),
  // FK→flow_groups.id; null ⇒ "My Flows" (ungrouped).
  groupId: text('group_id'),
});

export const flowGroups = pgTable(
  'flow_groups',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    userId: text('user_id'), // creator (provenance) — null for legacy/shared
    tenantId: text('tenant_id'), // org scope
    // Set ⇒ plugin-owned (locked, non-deletable). Null ⇒ user-created group.
    pluginId: text('plugin_id'),
    // True ⇒ owning plugin is disabled → group renders dimmed.
    disabled: boolean('disabled').notNull().default(false),
    createdAt: bigint('created_at', { mode: 'number' }).notNull(),
    updatedAt: bigint('updated_at', { mode: 'number' }).notNull(),
  },
  (t) => [index('flow_groups_owner_idx').on(t.userId, t.tenantId)],
);

export const flowRuns = pgTable(
  'flow_runs',
  {
    id: text('id').primaryKey(),
    flowId: text('flow_id').notNull(),
    userId: text('user_id'), // who triggered it — null for legacy/unauthed
    tenantId: text('tenant_id'), // org scope
    startedAt: bigint('started_at', { mode: 'number' }).notNull(),
    durationMs: integer('duration_ms').notNull().default(0),
    status: text('status').notNull().default('completed'), // 'completed' | 'error'
    source: text('source').notNull().default('test'), // 'test' | 'production'
    events: text('events').notNull().default('[]'), // JSON string of FlowRunEvent[]
    createdAt: bigint('created_at', { mode: 'number' }).notNull(),
  },
  (t) => [index('flow_runs_flow_idx').on(t.flowId, t.startedAt)],
);
