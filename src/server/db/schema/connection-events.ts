import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';
import { organization } from './auth';
import { servers } from './servers';

export const connectionEvents = sqliteTable(
  'connection_events',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    serverId: text('server_id')
      .notNull()
      .references(() => servers.id, { onDelete: 'cascade' }),
    eventType: text('event_type').notNull(),
    hostName: text('host_name'),
    hostUrl: text('host_url'),
    durationMs: integer('duration_ms'),
    reason: text('reason'),
    occurredAt: integer('occurred_at').notNull(),
  },
  (t) => [
    index('idx_conn_events_tenant').on(t.tenantId),
    index('idx_conn_events_server').on(t.serverId),
  ],
);
