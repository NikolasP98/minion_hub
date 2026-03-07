import { sqliteTable, text, integer, primaryKey, index } from 'drizzle-orm/sqlite-core';
import { user } from './auth';
import { servers } from './servers';

export const userAgents = sqliteTable(
	'user_agents',
	{
		userId: text('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		agentId: text('agent_id').notNull(),
		serverId: text('server_id')
			.notNull()
			.references(() => servers.id, { onDelete: 'cascade' }),
		createdAt: integer('created_at').notNull(),
	},
	(t) => [
		primaryKey({ columns: [t.userId, t.agentId, t.serverId] }),
		index('idx_user_agents_server').on(t.serverId),
	],
);
