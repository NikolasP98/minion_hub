import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';

/**
 * History of flow Test Runs. One row per manual run; `events` holds the full
 * ordered FlowRunEvent[] (node lifecycle + I/O) as a JSON string so a past run
 * can be replayed into the console exactly as it happened.
 */
export const flowRuns = sqliteTable(
  'flow_runs',
  {
    id: text('id').primaryKey(),
    flowId: text('flow_id').notNull(),
    userId: text('user_id'), // who triggered it — null for legacy/unauthed
    tenantId: text('tenant_id'), // tenant scope
    startedAt: integer('started_at').notNull(),
    durationMs: integer('duration_ms').notNull().default(0),
    status: text('status').notNull().default('completed'), // 'completed' | 'error'
    source: text('source').notNull().default('test'), // 'test' (manual Test Run) | 'production' (live trigger)
    events: text('events').notNull().default('[]'), // JSON string of FlowRunEvent[]
    createdAt: integer('created_at').notNull(),
  },
  (t) => [index('flow_runs_flow_idx').on(t.flowId, t.startedAt)],
);
