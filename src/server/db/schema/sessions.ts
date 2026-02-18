import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';
import { tenants } from './tenants';
import { servers } from './servers';

export const sessions = sqliteTable(
  'sessions',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    serverId: text('server_id')
      .notNull()
      .references(() => servers.id, { onDelete: 'cascade' }),
    agentId: text('agent_id').notNull(),
    sessionKey: text('session_key').notNull(),
    status: text('status', { enum: ['running', 'thinking', 'idle', 'aborted', 'completed'] })
      .notNull()
      .default('idle'),
    metadata: text('metadata'),
    startedAt: integer('started_at'),
    endedAt: integer('ended_at'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [
    index('idx_sessions_tenant').on(t.tenantId),
    index('idx_sessions_server').on(t.serverId),
  ],
);
