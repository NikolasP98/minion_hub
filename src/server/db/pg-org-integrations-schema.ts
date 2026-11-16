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
  },
  (t) => ({
    activeIdx: index('org_api_keys_active_idx')
      .on(t.orgId)
      .where(sql`revoked_at is null`),
  }),
);
