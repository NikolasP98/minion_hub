import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';
import { organization } from './auth';
import { servers } from './servers';

export const reliabilityEvents = sqliteTable(
  'reliability_events',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    serverId: text('server_id')
      .notNull()
      .references(() => servers.id, { onDelete: 'cascade' }),
    agentId: text('agent_id'),
    category: text('category', {
      enum: ['cron', 'browser', 'timezone', 'general', 'auth', 'skill', 'agent', 'gateway'],
    }).notNull(),
    severity: text('severity', { enum: ['critical', 'high', 'medium', 'low', 'ok'] }).notNull(),
    event: text('event').notNull(),
    message: text('message').notNull(),
    metadata: text('metadata'),
    occurredAt: integer('occurred_at').notNull(),
    createdAt: integer('created_at').notNull(),
  },
  // No service reads or writes this table (the reliability dashboard streams live
  // data over WS from the gateway, not from the DB). The three server_* composite
  // indexes were pure write-tax for query patterns that never run — dropped. The
  // tenant index is retained so the organization onDelete: cascade stays cheap.
  (t) => [index('idx_rel_events_tenant').on(t.tenantId)],
);
