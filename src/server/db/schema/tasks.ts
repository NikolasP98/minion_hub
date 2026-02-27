import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';
import { organization } from './auth';
import { missions } from './missions';

export const tasks = sqliteTable(
  'tasks',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    missionId: text('mission_id')
      .notNull()
      .references(() => missions.id, { onDelete: 'cascade' }),
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
    index('idx_tasks_tenant').on(t.tenantId),
    index('idx_tasks_mission').on(t.missionId),
  ],
);
