import { sqliteTable, text, integer, index, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { organization } from './auth';

export const servers = sqliteTable(
  'servers',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    url: text('url').notNull(),
    token: text('token').notNull().default(''),
    tokenIv: text('token_iv').notNull().default(''),
    authMode: text('auth_mode', { enum: ['token', 'none'] })
      .notNull()
      .default('token'),
    lastConnectedAt: integer('last_connected_at'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [
    index('idx_servers_tenant').on(t.tenantId),
    uniqueIndex('servers_uniq_url').on(t.tenantId, t.url),
  ],
);
