import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';
import { organization } from './auth';

export const backupConfigs = sqliteTable(
  'backup_configs',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    backupHost: text('backup_host'),
    backupUser: text('backup_user').default('root'),
    backupPort: integer('backup_port').default(22),
    backupBasePath: text('backup_base_path').default('/mnt/agent-data/backups'),
    schedule: text('schedule'),
    retentionCount: integer('retention_count').default(7),
    enabled: integer('enabled').default(0),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [
    index('idx_backup_configs_tenant').on(t.tenantId),
  ],
);
