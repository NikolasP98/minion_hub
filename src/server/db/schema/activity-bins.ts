import { sqliteTable, text, integer, index, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { tenants } from './tenants';
import { servers } from './servers';

export const activityBins = sqliteTable(
  'agent_activity_bins',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    serverId: text('server_id')
      .notNull()
      .references(() => servers.id, { onDelete: 'cascade' }),
    agentId: text('agent_id').notNull(),
    binTs: integer('bin_ts').notNull(),
    count: integer('count').notNull().default(0),
  },
  (t) => [
    uniqueIndex('idx_activity_bins_unique').on(t.serverId, t.agentId, t.binTs),
    index('idx_activity_bins_lookup').on(t.serverId, t.agentId, t.binTs),
  ],
);
