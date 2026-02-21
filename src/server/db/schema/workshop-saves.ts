import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

export const workshopSaves = sqliteTable('workshop_saves', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  state: text('state').notNull(), // JSON string of WorkshopState
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});
