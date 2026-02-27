import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';
import { organization } from './auth';
import { servers } from './servers';
import { sessions } from './sessions';

export const missions = sqliteTable(
  'missions',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    serverId: text('server_id')
      .notNull()
      .references(() => servers.id, { onDelete: 'cascade' }),
    sessionId: text('session_id')
      .notNull()
      .references(() => sessions.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    description: text('description'),
    status: text('status', { enum: ['active', 'completed', 'cancelled'] })
      .notNull()
      .default('active'),
    metadata: text('metadata'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [
    index('idx_missions_tenant').on(t.tenantId),
    index('idx_missions_session').on(t.sessionId),
    index('idx_missions_server').on(t.serverId),
  ],
);
