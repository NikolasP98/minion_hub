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
  // No service reads or writes this table. The server index was pure write-tax for
  // a query pattern that never runs — dropped. The tenant index is retained so the
  // organization onDelete: cascade stays cheap.
  (t) => [index('idx_conn_events_tenant').on(t.tenantId)],
);
