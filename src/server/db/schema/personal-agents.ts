import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';
import { user } from './auth';
import { servers } from './servers';

export const personalAgents = sqliteTable(
  'personal_agents',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .unique()
      .references(() => user.id, { onDelete: 'cascade' }),
    agentId: text('agent_id').notNull(),
    serverId: text('server_id').references(() => servers.id, { onDelete: 'set null' }),
    /** @deprecated See @minion-stack/db schema. Removed by 0012 migration. */
    displayName: text('display_name').notNull(),
    /** @deprecated See @minion-stack/db schema. Removed by 0013 migration (Phase 3c). */
    conversationName: text('conversation_name'),
    avatarUrl: text('avatar_url'),
    /** @deprecated See @minion-stack/db schema. Removed by 0013 migration (Phase 3c). */
    personalityPreset: text('personality_preset', {
      enum: ['professional', 'casual', 'creative', 'technical'],
    }),
    /** @deprecated See @minion-stack/db schema. Removed by 0013 migration (Phase 3c). */
    personalityText: text('personality_text'),
    /** @deprecated See @minion-stack/db schema. Removed by 0013 migration (Phase 3c). */
    personalityConfigured: integer('personality_configured', { mode: 'boolean' })
      .notNull()
      .default(false),
    provisioningStatus: text('provisioning_status', {
      enum: ['pending', 'provisioning', 'active', 'error'],
    })
      .notNull()
      .default('pending'),
    provisioningError: text('provisioning_error'),
    lastRetryAt: integer('last_retry_at'),
    retryCount: integer('retry_count').notNull().default(0),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [
    index('idx_personal_agents_user').on(t.userId),
    index('idx_personal_agents_agent').on(t.agentId),
    index('idx_personal_agents_status').on(t.provisioningStatus),
  ],
);
