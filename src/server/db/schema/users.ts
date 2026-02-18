import { sqliteTable, text, integer, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { tenants } from './tenants';

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  displayName: text('display_name'),
  kind: text('kind', { enum: ['operator', 'contact'] }).notNull().default('operator'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

export const userTenants = sqliteTable(
  'user_tenants',
  {
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    role: text('role', { enum: ['owner', 'admin', 'member', 'viewer'] })
      .notNull()
      .default('member'),
    joinedAt: integer('joined_at').notNull(),
  },
  (t) => [uniqueIndex('uq_user_tenant').on(t.userId, t.tenantId)],
);
