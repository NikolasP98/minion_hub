import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';
import { tenants } from './tenants';
import { servers } from './servers';

export const skillExecutionStats = sqliteTable(
  'skill_execution_stats',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    serverId: text('server_id')
      .notNull()
      .references(() => servers.id, { onDelete: 'cascade' }),
    agentId: text('agent_id'),
    skillName: text('skill_name').notNull(),
    sessionKey: text('session_key'),
    status: text('status', { enum: ['ok', 'auth_error', 'timeout', 'error'] }).notNull(),
    durationMs: integer('duration_ms'),
    errorMessage: text('error_message'),
    occurredAt: integer('occurred_at').notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [
    index('idx_skill_stats_server_skill_time').on(t.serverId, t.skillName, t.occurredAt),
    index('idx_skill_stats_tenant').on(t.tenantId),
  ],
);
