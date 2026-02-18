import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';
import { tenants } from './tenants';
import { servers } from './servers';

export const chatMessages = sqliteTable(
  'chat_messages',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    serverId: text('server_id')
      .notNull()
      .references(() => servers.id, { onDelete: 'cascade' }),
    agentId: text('agent_id').notNull(),
    sessionKey: text('session_key').notNull(),
    role: text('role', { enum: ['user', 'assistant'] }).notNull(),
    content: text('content').notNull(),
    runId: text('run_id'),
    timestamp: integer('timestamp').notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [
    index('idx_chat_tenant').on(t.tenantId),
    index('idx_chat_by_agent').on(t.agentId, t.sessionKey, t.timestamp),
  ],
);
