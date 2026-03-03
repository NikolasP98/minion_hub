import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

export const flows = sqliteTable('flows', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  nodes: text('nodes').notNull().default('[]'), // JSON string of FlowNode[]
  edges: text('edges').notNull().default('[]'), // JSON string of FlowEdge[]
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});
