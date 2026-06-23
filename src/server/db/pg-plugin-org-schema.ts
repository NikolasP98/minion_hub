import { pgTable, text, uuid, boolean, timestamp, primaryKey } from 'drizzle-orm/pg-core';

/**
 * Per-org plugin disable state — the DB-authoritative home of the gateway's
 * `plugins.orgDisabled[pluginId] = [orgId,…]` map (org-scope → DB; the gateway
 * file is now a derived cache the hub pushes to via `reconcileOrgConfig`).
 *
 * A row with `disabled = true` means that org turned the plugin OFF. Absent row
 * (or disabled=false) = enabled — mirrors the gateway's fail-open semantics.
 * Keyed (org, gateway, plugin): plugins are installed globally on the shared
 * gateway but each org toggles independently.
 */
export const pluginOrgDisabled = pgTable(
  'plugin_org_disabled',
  {
    orgId: uuid('org_id').notNull(),
    gatewayId: uuid('gateway_id').notNull(),
    pluginId: text('plugin_id').notNull(),
    disabled: boolean('disabled').notNull().default(true),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ pk: primaryKey({ columns: [t.orgId, t.gatewayId, t.pluginId] }) }),
);

export type PluginOrgDisabled = typeof pluginOrgDisabled.$inferSelect;
