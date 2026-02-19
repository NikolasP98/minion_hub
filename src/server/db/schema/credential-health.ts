import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';
import { tenants } from './tenants';
import { servers } from './servers';

export const credentialHealthSnapshots = sqliteTable(
  'credential_health_snapshots',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    serverId: text('server_id')
      .notNull()
      .references(() => servers.id, { onDelete: 'cascade' }),
    snapshotJson: text('snapshot_json').notNull(),
    capturedAt: integer('captured_at').notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [
    index('idx_cred_health_server_time').on(t.serverId, t.capturedAt),
    index('idx_cred_health_tenant').on(t.tenantId),
  ],
);
