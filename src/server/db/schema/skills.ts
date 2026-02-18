import { sqliteTable, text, integer, index, primaryKey } from 'drizzle-orm/sqlite-core';
import { tenants } from './tenants';
import { servers } from './servers';

export const skills = sqliteTable(
  'skills',
  {
    skillKey: text('skill_key').notNull(),
    serverId: text('server_id')
      .notNull()
      .references(() => servers.id, { onDelete: 'cascade' }),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description'),
    emoji: text('emoji'),
    bundled: integer('bundled', { mode: 'boolean' }).notNull().default(false),
    disabled: integer('disabled', { mode: 'boolean' }).notNull().default(false),
    eligible: integer('eligible', { mode: 'boolean' }).notNull().default(false),
    rawJson: text('raw_json').notNull(),
    lastSeenAt: integer('last_seen_at').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.skillKey, t.serverId] }),
    index('idx_skills_tenant').on(t.tenantId),
  ],
);
