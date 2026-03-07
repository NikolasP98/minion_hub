import { sqliteTable, text, integer, index, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { organization } from './auth';
import { channels } from './channels';

export const channelAssignments = sqliteTable(
  'channel_assignments',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    channelId: text('channel_id')
      .notNull()
      .references(() => channels.id, { onDelete: 'cascade' }),
    targetType: text('target_type', { enum: ['user', 'session'] }).notNull(),
    targetId: text('target_id').notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [
    index('idx_channel_assign_channel').on(t.channelId),
    uniqueIndex('channel_assign_uniq').on(t.channelId, t.targetType, t.targetId),
  ],
);
