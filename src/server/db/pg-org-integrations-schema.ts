import {
  pgTable,
  uuid,
  text,
  timestamp,
  index,
  boolean,
  integer,
  date,
  jsonb,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
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
    memberSince: timestamp('member_since', { withTimezone: true }).notNull(),
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

/**
 * Record lock policy (spec 140). Mirror of `20261124100000_record_lock_policy.sql`; the migration is
 * canonical (forced RLS + `<table>_org_guc` live there). No policy row = the default (month close only).
 */
export const orgLockPolicy = pgTable('org_lock_policy', {
  orgId: text('org_id').primaryKey(),
  monthEnabled: boolean('month_enabled').notNull().default(true),
  daysEnabled: boolean('days_enabled').notNull().default(false),
  days: integer('days'),
  sunatEnabled: boolean('sunat_enabled').notNull().default(false),
  webhookEnabled: boolean('webhook_enabled').notNull().default(false),
  updatedBy: uuid('updated_by'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/** External locks (webhook). Lifted, never deleted. */
export const orgRecordLocks = pgTable(
  'org_record_locks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: text('org_id').notNull(),
    source: text('source').notNull().default('webhook'),
    label: text('label').notNull(),
    recordType: text('record_type'),
    upTo: date('up_to', { mode: 'string' }),
    recordId: uuid('record_id'),
    apiKeyId: uuid('api_key_id'),
    actorName: text('actor_name'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    liftedAt: timestamp('lifted_at', { withTimezone: true }),
    liftedByKind: text('lifted_by_kind'),
    liftedBy: uuid('lifted_by'),
    liftReason: text('lift_reason'),
  },
  (t) => ({
    activeUpToUniq: uniqueIndex('org_record_locks_active_upto_uniq')
      .on(t.orgId, sql`coalesce(${t.recordType}, '')`, t.label, t.upTo)
      .where(sql`up_to is not null and lifted_at is null`),
    activeRecordUniq: uniqueIndex('org_record_locks_active_record_uniq')
      .on(t.orgId, t.recordType, t.recordId)
      .where(sql`record_id is not null and lifted_at is null`),
    activeIdx: index('org_record_locks_active_idx')
      .on(t.orgId)
      .where(sql`lifted_at is null`),
  }),
);

/** Append-only audit of locks, unlocks, refusals and policy changes (no update or delete grant). */
export const orgLockEvents = pgTable(
  'org_lock_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: text('org_id').notNull(),
    action: text('action').notNull(),
    recordType: text('record_type'),
    recordId: uuid('record_id'),
    rules: jsonb('rules')
      .notNull()
      .default(sql`'[]'`),
    actorKind: text('actor_kind').notNull(),
    actorId: uuid('actor_id'),
    actorName: text('actor_name'),
    reason: text('reason'),
    detail: jsonb('detail')
      .notNull()
      .default(sql`'{}'`),
    refEventId: uuid('ref_event_id'),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    usedUniq: uniqueIndex('org_lock_events_used_uniq')
      .on(t.orgId, t.refEventId)
      .where(sql`action = 'unlock_used'`),
    orgTimeIdx: index('org_lock_events_org_time_idx').on(t.orgId, t.occurredAt),
    recordIdx: index('org_lock_events_record_idx').on(
      t.orgId,
      t.recordType,
      t.recordId,
      t.occurredAt,
    ),
  }),
);

export type OrgLockPolicyRow = typeof orgLockPolicy.$inferSelect;
export type OrgRecordLockRow = typeof orgRecordLocks.$inferSelect;
export type OrgLockEventRow = typeof orgLockEvents.$inferSelect;
