import { sqliteTable, text, integer, index, primaryKey } from 'drizzle-orm/sqlite-core';
import { organization, user } from './auth';

export const agentGroups = sqliteTable(
  'agent_groups',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    sortOrder: integer('sort_order').default(0),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [index('idx_agent_groups_user').on(t.userId, t.tenantId)],
);

export const agentGroupMembers = sqliteTable(
  'agent_group_members',
  {
    groupId: text('group_id')
      .notNull()
      .references(() => agentGroups.id, { onDelete: 'cascade' }),
    agentId: text('agent_id').notNull(),
    sortOrder: integer('sort_order').default(0),
  },
  (t) => [
    primaryKey({ columns: [t.groupId, t.agentId] }),
  ],
);
