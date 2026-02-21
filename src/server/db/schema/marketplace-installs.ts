import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';
import { tenants } from './tenants';
import { servers } from './servers';
import { marketplaceAgents } from './marketplace-agents';

export const marketplaceInstalls = sqliteTable(
  'marketplace_installs',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    agentId: text('agent_id')
      .notNull()
      .references(() => marketplaceAgents.id, { onDelete: 'cascade' }),
    serverId: text('server_id')
      .notNull()
      .references(() => servers.id, { onDelete: 'cascade' }),
    installedAt: integer('installed_at').notNull(),
  },
  (t) => [
    index('idx_marketplace_installs_tenant').on(t.tenantId),
    index('idx_marketplace_installs_agent').on(t.agentId),
  ],
);
