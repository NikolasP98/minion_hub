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
    category: text('category', { enum: ['cron', 'browser', 'timezone', 'general', 'auth', 'skill', 'agent', 'gateway'] }).notNull(),
    severity: text('severity', { enum: ['critical', 'high', 'medium', 'low'] }).notNull(),
    event: text('event').notNull(),
    message: text('message').notNull(),
    metadata: text('metadata'),
    occurredAt: integer('occurred_at').notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [
    index('idx_rel_events_server_cat_time').on(t.serverId, t.category, t.occurredAt),
    index('idx_rel_events_server_time').on(t.serverId, t.occurredAt),
    index('idx_rel_events_tenant').on(t.tenantId),
  ],
);
