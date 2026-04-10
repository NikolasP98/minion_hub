import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

export const workshopSaves = sqliteTable('workshop_saves', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  state: text('state').notNull(), // JSON string of WorkshopState
  thumbnail: text('thumbnail'), // base64 PNG data-URI, nullable
  userId: text('user_id'), // owner — null for pre-migration rows (treated as shared)
  tenantId: text('tenant_id'), // tenant scope — null for pre-migration rows
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});
