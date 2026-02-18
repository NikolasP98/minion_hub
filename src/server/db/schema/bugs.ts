import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';
import { tenants } from './tenants';
import { servers } from './servers';

export const bugs = sqliteTable(
  'bugs',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    serverId: text('server_id')
      .notNull()
      .references(() => servers.id, { onDelete: 'cascade' }),
    agentId: text('agent_id'),
    errorCode: text('error_code'),
    message: text('message').notNull(),
    stack: text('stack'),
    severity: text('severity', { enum: ['critical', 'high', 'medium', 'low'] })
      .notNull()
      .default('medium'),
    status: text('status', { enum: ['new', 'acknowledged', 'resolved', 'ignored'] })
      .notNull()
      .default('new'),
    metadata: text('metadata'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [
    index('idx_bugs_tenant').on(t.tenantId),
    index('idx_bugs_server').on(t.serverId),
  ],
);
