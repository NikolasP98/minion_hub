import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';
import { organization } from './auth';
import { servers } from './servers';

export const serverBackups = sqliteTable(
  'server_backups',
  {
    id: text('id').primaryKey(),
    serverId: text('server_id')
      .notNull()
      .references(() => servers.id, { onDelete: 'cascade' }),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    snapshotPath: text('snapshot_path').notNull(),
    timestamp: integer('timestamp').notNull(),
    sizeBytes: integer('size_bytes'),
    status: text('status', { enum: ['running', 'complete', 'failed'] }).notNull().default('running'),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [
    index('idx_server_backups_server').on(t.serverId),
    index('idx_server_backups_tenant').on(t.tenantId),
  ],
);
