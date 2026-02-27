import { sqliteTable, text, integer, index, primaryKey } from 'drizzle-orm/sqlite-core';
import { organization } from './auth';
import { servers } from './servers';

export const agents = sqliteTable(
  'agents',
  {
    id: text('id').notNull(),
    serverId: text('server_id')
      .notNull()
      .references(() => servers.id, { onDelete: 'cascade' }),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    name: text('name'),
    emoji: text('emoji'),
    description: text('description'),
    model: text('model'),
    status: text('status', { enum: ['active', 'inactive'] }).default('active'),
    rawJson: text('raw_json').notNull(),
    lastSeenAt: integer('last_seen_at').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.id, t.serverId] }),
    index('idx_agents_tenant').on(t.tenantId),
  ],
);
