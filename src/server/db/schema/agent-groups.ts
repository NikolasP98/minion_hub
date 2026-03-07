import { sqliteTable, text, integer, index, primaryKey } from 'drizzle-orm/sqlite-core';
import { organization } from './auth';
import { servers } from './servers';

export const agentGroups = sqliteTable(
  'agent_groups',
  {
    id: text('id').primaryKey(),
    serverId: text('server_id')
      .notNull()
      .references(() => servers.id, { onDelete: 'cascade' }),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    sortOrder: integer('sort_order').default(0),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [index('idx_agent_groups_server').on(t.serverId)],
);

export const agentGroupMembers = sqliteTable(
  'agent_group_members',
  {
    groupId: text('group_id')
      .notNull()
      .references(() => agentGroups.id, { onDelete: 'cascade' }),
    agentId: text('agent_id').notNull(),
    serverId: text('server_id')
      .notNull()
      .references(() => servers.id, { onDelete: 'cascade' }),
    sortOrder: integer('sort_order').default(0),
  },
  (t) => [
    primaryKey({ columns: [t.groupId, t.agentId, t.serverId] }),
    index('idx_agm_agent').on(t.agentId, t.serverId),
  ],
);
