import { sqliteTable, text, integer, index, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { organization } from './auth';
import { servers } from './servers';

export const serverProvisionConfigs = sqliteTable(
  'server_provision_configs',
  {
    id: text('id').primaryKey(),
    serverId: text('server_id')
      .notNull()
      .references(() => servers.id, { onDelete: 'cascade' }),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),

    // SSH connection
    sshHost: text('ssh_host'),
    sshUser: text('ssh_user').default('root'),
    sshPort: integer('ssh_port').default(22),

    // Credentials (encrypted)
    apiKey: text('api_key'),
    apiKeyIv: text('api_key_iv'),

    // Agent config
    agentName: text('agent_name'),
    sandboxMode: text('sandbox_mode', { enum: ['non-main', 'always', 'never'] }).default('non-main'),
    dmPolicy: text('dm_policy', { enum: ['pairing', 'solo', 'disabled'] }).default('pairing'),

    // Install config
    installMethod: text('install_method', { enum: ['package', 'source'] }).default('package'),
    pkgManager: text('pkg_manager', { enum: ['npm', 'bun'] }).default('npm'),

    // Gateway config
    gatewayPort: integer('gateway_port').default(18789),
    gatewayBind: text('gateway_bind', { enum: ['loopback', 'all'] }).default('loopback'),

    // Channel toggles
    enableWhatsapp: integer('enable_whatsapp').default(0),
    enableTelegram: integer('enable_telegram').default(0),
    enableDiscord: integer('enable_discord').default(0),

    // Provision state
    phaseStatuses: text('phase_statuses').default('{}'),
    lastProvisionAt: integer('last_provision_at'),

    // Timestamps
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [
    uniqueIndex('provision_configs_uniq_server').on(t.serverId),
    index('idx_provision_configs_tenant').on(t.tenantId),
  ],
);
