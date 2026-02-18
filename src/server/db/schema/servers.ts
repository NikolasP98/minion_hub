import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';
import { tenants } from './tenants';

export const servers = sqliteTable(
  'servers',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    url: text('url').notNull(),
    token: text('token').notNull().default(''),
    authMode: text('auth_mode', { enum: ['token', 'none'] })
      .notNull()
      .default('token'),
    lastConnectedAt: integer('last_connected_at'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [index('idx_servers_tenant').on(t.tenantId)],
);
