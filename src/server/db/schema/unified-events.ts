import { sqliteTable, text, integer, index, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { organization } from './auth';
import { servers } from './servers';

export const unifiedEvents = sqliteTable(
  'unified_events',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    serverId: text('server_id')
      .notNull()
      .references(() => servers.id, { onDelete: 'cascade' }),
    localEventId: integer('local_event_id').notNull(),
    category: text('category').notNull(),
    severity: text('severity', { enum: ['critical', 'high', 'medium', 'low', 'info'] }).notNull(),
    event: text('event').notNull(),
    message: text('message').notNull(),
    agentId: text('agent_id'),
    correlationId: text('correlation_id'),
    metadata: text('metadata'),
    occurredAt: integer('occurred_at').notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [
    index('idx_unified_events_tenant').on(t.tenantId),
    index('idx_unified_events_server_cat_time').on(t.serverId, t.category, t.occurredAt),
    index('idx_unified_events_server_time').on(t.serverId, t.occurredAt),
    index('idx_unified_events_correlation').on(t.correlationId),
    uniqueIndex('idx_unified_events_dedup').on(t.tenantId, t.serverId, t.localEventId),
  ],
);
