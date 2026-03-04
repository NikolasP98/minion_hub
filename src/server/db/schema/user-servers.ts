import { sqliteTable, text, integer, primaryKey } from 'drizzle-orm/sqlite-core';
import { user } from './auth';
import { servers } from './servers';

export const userServers = sqliteTable(
  'user_servers',
  {
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    serverId: text('server_id')
      .notNull()
      .references(() => servers.id, { onDelete: 'cascade' }),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.serverId] })],
);
