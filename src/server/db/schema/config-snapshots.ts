import { sqliteTable, text, integer, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { tenants } from './tenants';
import { servers } from './servers';

export const configSnapshots = sqliteTable(
  'config_snapshots',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    serverId: text('server_id')
      .notNull()
      .references(() => servers.id, { onDelete: 'cascade' }),
    configJson: text('config_json').notNull(),
    configHash: text('config_hash').notNull(),
    fetchedAt: integer('fetched_at').notNull(),
  },
  (t) => [
    uniqueIndex('idx_config_snapshots_server').on(t.serverId),
  ],
);
