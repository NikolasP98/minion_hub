import { sqliteTable, text, integer, uniqueIndex, index } from 'drizzle-orm/sqlite-core';
import { user } from './auth';

/**
 * Maps channel sender IDs (e.g. telegram:12345, discord:67890) to hub users.
 * Used by the gateway to resolve user identity from channel messages.
 */
export const channelIdentities = sqliteTable(
	'channel_identities',
	{
		id: text('id').primaryKey(),
		userId: text('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		channel: text('channel').notNull(),
		channelUserId: text('channel_user_id').notNull(),
		displayName: text('display_name'),
		verifiedAt: integer('verified_at'),
		createdAt: integer('created_at').notNull(),
	},
	(t) => [
		uniqueIndex('idx_channel_identity_unique').on(t.channel, t.channelUserId),
		index('idx_channel_identity_user').on(t.userId),
	],
);
