import { sqliteTable, text, integer, index, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { organization } from './auth';
import { servers } from './servers';

export const channels = sqliteTable(
  'channels',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    serverId: text('server_id')
      .notNull()
      .references(() => servers.id, { onDelete: 'cascade' }),
    type: text('type', { enum: ['discord', 'whatsapp', 'telegram'] }).notNull(),
    label: text('label').notNull(),
    credentials: text('credentials').notNull().default(''),
    credentialsIv: text('credentials_iv').notNull().default(''),
    credentialsMeta: text('credentials_meta').notNull().default('{}'),
    status: text('status', { enum: ['active', 'inactive', 'pairing'] })
      .notNull()
      .default('inactive'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [
    index('idx_channels_tenant_server').on(t.tenantId, t.serverId),
    uniqueIndex('channels_uniq_type_label').on(t.tenantId, t.serverId, t.type, t.label),
  ],
);
