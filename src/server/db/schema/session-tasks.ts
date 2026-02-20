import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';
import { tenants } from './tenants';
import { servers } from './servers';

export const sessionTasks = sqliteTable(
  'session_tasks',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    serverId: text('server_id')
      .notNull()
      .references(() => servers.id, { onDelete: 'cascade' }),
    sessionKey: text('session_key').notNull(),
    title: text('title').notNull(),
    description: text('description'),
    status: text('status', { enum: ['backlog', 'todo', 'in_progress', 'done'] })
      .notNull()
      .default('backlog'),
    sortOrder: integer('sort_order').notNull().default(0),
    metadata: text('metadata'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [
    index('idx_session_tasks_tenant').on(t.tenantId),
    index('idx_session_tasks_server_session').on(t.serverId, t.sessionKey),
  ],
);
