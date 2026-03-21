import { sqliteTable, text, integer, uniqueIndex, index } from 'drizzle-orm/sqlite-core';
import { user } from './auth';

export const userPreferences = sqliteTable(
  'user_preferences',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    section: text('section').notNull(),
    value: text('value').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [
    uniqueIndex('uq_user_prefs_user_section').on(t.userId, t.section),
    index('idx_user_prefs_user').on(t.userId),
  ],
);
