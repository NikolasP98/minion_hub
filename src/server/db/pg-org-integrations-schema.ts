import { pgTable, uuid, text, timestamp, index } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

/**
 * Organization integrations (spec 121). Mirror of
 * `supabase/migrations/20261116100000_org_api_keys.sql` — the migration is canonical
 * (forced RLS + `org_api_keys_org_guc` live there; Drizzle does not manage RLS).
 */

/** A named secret of one organization. The key text itself is never stored. */
export const orgApiKeys = pgTable(
  'org_api_keys',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: text('org_id').notNull(),
    name: text('name').notNull(),
    /** 8 hex characters, globally unique; shown to admins as `mk_<prefix>_…`. */
    prefix: text('prefix').notNull().unique(),
    /** SHA-256 hex of the whole key. Never returned by any API. */
    keyHash: text('key_hash').notNull(),
    createdBy: uuid('created_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    revokedBy: uuid('revoked_by'),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    /** Abilities beyond doors (spec 136); fixed at creation. */
    scopes: text('scopes')
      .array()
      .notNull()
      .default(sql`'{}'`),
  },
  (t) => ({
    activeIdx: index('org_api_keys_active_idx')
      .on(t.orgId)
      .where(sql`revoked_at is null`),
  }),
);

/**
 * Sign-in to the MCP endpoint (spec 143). Mirror of `20261121100000_mcp_oauth.sql`; the
 * migration is canonical. Reached only through the privileged core handle.
 */
export const mcpClients = pgTable('mcp_clients', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  redirectUris: text('redirect_uris').array().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  createdIp: text('created_ip'),
});

export const mcpConnections = pgTable(
  'mcp_connections',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').notNull(),
    clientId: text('client_id')
      .notNull()
      .references(() => mcpClients.id, { onDelete: 'cascade' }),
    orgId: text('org_id').notNull(),
    approvedAt: timestamp('approved_at', { withTimezone: true }).notNull().defaultNow(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    revokedBy: uuid('revoked_by'),
  },
  (t) => ({
    orgLiveIdx: index('mcp_connections_org_live_idx')
      .on(t.orgId)
      .where(sql`revoked_at is null`),
    userLiveIdx: index('mcp_connections_user_live_idx')
      .on(t.userId)
      .where(sql`revoked_at is null`),
  }),
);

export const mcpCredentials = pgTable(
  'mcp_credentials',
  {
    hash: text('hash').primaryKey(),
    kind: text('kind').notNull(),
    connectionId: uuid('connection_id').references(() => mcpConnections.id, {
      onDelete: 'cascade',
    }),
    clientId: text('client_id')
      .notNull()
      .references(() => mcpClients.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').notNull(),
    orgId: text('org_id').notNull(),
    redirectUri: text('redirect_uri'),
    codeChallenge: text('code_challenge'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    regrantedAt: timestamp('regranted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ connectionIdx: index('mcp_credentials_connection_idx').on(t.connectionId) }),
);
