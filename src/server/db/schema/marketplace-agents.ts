import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

export const marketplaceAgents = sqliteTable('marketplace_agents', {
  id: text('id').primaryKey(), // slug e.g. "luna-chen"
  name: text('name').notNull(),
  role: text('role').notNull(),
  category: text('category').notNull(), // engineering | product | data | creative | security
  tags: text('tags').notNull(), // JSON array string
  description: text('description').notNull(),
  catchphrase: text('catchphrase'),
  version: text('version').notNull(),
  model: text('model'),
  avatarSeed: text('avatar_seed').notNull(),
  githubPath: text('github_path').notNull(),
  soulMd: text('soul_md'),
  identityMd: text('identity_md'),
  userMd: text('user_md'),
  contextMd: text('context_md'),
  skillsMd: text('skills_md'),
  installCount: integer('install_count').default(0),
  syncedAt: integer('synced_at').notNull(),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});
