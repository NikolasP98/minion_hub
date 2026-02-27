import { sqliteTable, text, integer, real, index } from 'drizzle-orm/sqlite-core';
import { organization } from './auth';
import { servers } from './servers';

export const gatewayHeartbeats = sqliteTable(
  'gateway_heartbeats',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    serverId: text('server_id')
      .notNull()
      .references(() => servers.id, { onDelete: 'cascade' }),
    uptimeMs: integer('uptime_ms').notNull(),
    activeSessions: integer('active_sessions').notNull(),
    activeAgents: integer('active_agents').notNull(),
    memoryRssMb: real('memory_rss_mb'),
    credentialSummaryJson: text('credential_summary_json'),
    channelStatusJson: text('channel_status_json'),
    capturedAt: integer('captured_at').notNull(),
  },
  (t) => [
    index('idx_gw_heartbeats_server_time').on(t.serverId, t.capturedAt),
    index('idx_gw_heartbeats_tenant').on(t.tenantId),
  ],
);
