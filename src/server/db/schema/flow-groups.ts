import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';

export const flowGroups = sqliteTable(
  'flow_groups',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    userId: text('user_id'), // owner — null for legacy/shared
    tenantId: text('tenant_id'), // tenant scope
    // Set ⇒ plugin-owned (locked, non-deletable). Null ⇒ user-created group.
    pluginId: text('plugin_id'),
    // True ⇒ owning plugin is disabled → group renders dimmed. Always false for user groups.
    disabled: integer('disabled', { mode: 'boolean' }).notNull().default(false),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => ({
    ownerIdx: index('flow_groups_owner_idx').on(t.userId, t.tenantId),
  }),
);
