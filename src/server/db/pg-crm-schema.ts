import {
  pgTable,
  uuid,
  text,
  jsonb,
  timestamp,
  doublePrecision,
  integer,
  index,
  uniqueIndex,
  primaryKey,
} from 'drizzle-orm/pg-core';

/**
 * Hub-native CRM — Postgres schema (Supabase core DB).
 *
 * Deliberately hub-LOCAL (not promoted to `@minion-stack/db`) for v1: these
 * tables are queried only by the hub, and keeping them here avoids the
 * pack/vendor/reinstall cycle the vendored `@minion-stack/db` tarball requires.
 * Promote to the shared package only if the gateway ever needs them.
 *
 * Design principle (spec §1): the `messages` ledger IS the customer journey —
 * we never copy it. The journey timeline is a live VIEW over `messages` joined
 * on (org_id, channel, sender_id); the RFM score is an on-read SQL aggregate.
 * These tables only hold what the immutable ledger can't: a stable contact
 * identity + CRM-only attributes (tags, notes, lifecycle, ownership).
 *
 * RLS: every table uses `org_id text` to match `messages.org_id`, so journey
 * joins need no casts and the tables ride the same `withOrgCore()` transaction
 * (role `app_ledger` + `app.current_org_id` GUC). Policies + grants live in the
 * hand-written companion migration `supabase/migrations/<ts>_crm.sql` (Drizzle
 * does not manage roles/policies). EVERY query MUST route through
 * `withOrgCore` — `getCoreDb()` runs as a bypass role and would leak orgs.
 */

/** A person aggregated across every channel they've used to contact the org. */
export const crmContacts = pgTable(
  'crm_contacts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: text('org_id').notNull(),
    /** Best-known name; falls back to the ledger sender_name on read when null. */
    displayName: text('display_name'),
    /** Optional bridge to a hub user (profiles.id) once the contact claims a
     *  channel identity via /account. Null for the common external-contact case.
     *  No FK/cascade — cross-concern, soft reference. */
    profileId: uuid('profile_id'),
    /** Assigned hub user (profiles.id) — modeled for future per-rep visibility;
     *  not yet enforced by RLS in v1. */
    ownerId: uuid('owner_id'),
    /** Pins a lifecycle stage, overriding the derived one (spec §5). */
    lifecycleOverride: text('lifecycle_override'),
    /** 'harvested' (from the ledger) | 'manual' (created in the UI). */
    source: text('source').notNull().default('harvested'),
    /** Custom-field escape hatch (admin "+ Add property" — editor is v2). */
    customFields: jsonb('custom_fields').notNull().default({}),
    /** Soft-delete for right-to-erasure; hard-delete path also exists (spec §9). */
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    orgRecentIdx: index('crm_contacts_org_recent_idx').on(t.orgId, t.updatedAt),
    profileIdx: index('crm_contacts_profile_idx').on(t.profileId),
  }),
);

/**
 * Maps a ledger sender `(channel, external_id)` → contact. This is the harvest
 * upsert target and the timeline join key. A contact collapses many identities
 * (WhatsApp phone + Telegram handle + email) into one record.
 *
 * NOT reusing `user_identities`: that table's `user_id` is NOT NULL → profiles,
 * but harvested senders have no profile. This is `user_identities` minus the
 * auth coupling.
 */
export const crmContactIdentities = pgTable(
  'crm_contact_identities',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: text('org_id').notNull(),
    contactId: uuid('contact_id')
      .notNull()
      .references(() => crmContacts.id, { onDelete: 'cascade' }),
    /** == messages.channel */
    channel: text('channel').notNull(),
    /** == messages.sender_id */
    externalId: text('external_id').notNull(),
    /** Last-seen messages.sender_handle (display nicety; may drift). */
    handle: text('handle'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    /** The idempotency key — harvest upserts `ON CONFLICT` on this. */
    uniq: uniqueIndex('crm_contact_identity_uniq').on(t.orgId, t.channel, t.externalId),
    /** Matches the ledger's index shape → index-driven timeline join. */
    lookupIdx: index('crm_contact_identities_lookup_idx').on(t.orgId, t.channel, t.externalId),
    contactIdx: index('crm_contact_identities_contact_idx').on(t.contactId),
  }),
);

/**
 * ONLY non-message events: notes, tag/score/stage changes, manual log entries.
 * Message activities are NEVER stored here — they live in `messages` and surface
 * via the `crm_contact_timeline` view. Single `contact_id` FK (no polymorphic
 * join table) because there's only ever one target.
 */
export const crmActivities = pgTable(
  'crm_activities',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: text('org_id').notNull(),
    contactId: uuid('contact_id')
      .notNull()
      .references(() => crmContacts.id, { onDelete: 'cascade' }),
    /** 'note' | 'tag_change' | 'score' | 'stage' | 'manual' */
    kind: text('kind').notNull(),
    body: text('body'),
    /** profiles.id of the hub user who logged it; null for system/agent. */
    actorId: uuid('actor_id'),
    data: jsonb('data').notNull().default({}),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    contactIdx: index('crm_activities_contact_idx').on(t.contactId, t.occurredAt),
    orgIdx: index('crm_activities_org_idx').on(t.orgId, t.occurredAt),
  }),
);

/**
 * Tag definitions. Manual tags are applied via `crm_contact_tags`. Auto-tags
 * (`kind='auto'`) carry a `rule` jsonb evaluated LIVE in the ranking query —
 * they are never stored as `crm_contact_tags` rows in v1 (spec §7).
 */
export const crmTags = pgTable(
  'crm_tags',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: text('org_id').notNull(),
    name: text('name').notNull(),
    color: text('color'),
    /** 'manual' | 'auto' */
    kind: text('kind').notNull().default('manual'),
    /** Filter predicate over the ranking row; only for kind='auto'. */
    rule: jsonb('rule'),
    position: doublePrecision('position').notNull().default(0),
    createdBy: uuid('created_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniq: uniqueIndex('crm_tags_org_name_uniq').on(t.orgId, t.name),
    orgIdx: index('crm_tags_org_idx').on(t.orgId),
  }),
);

/** Manual tag applications (auto-tags are computed live, not stored here). */
export const crmContactTags = pgTable(
  'crm_contact_tags',
  {
    orgId: text('org_id').notNull(),
    contactId: uuid('contact_id')
      .notNull()
      .references(() => crmContacts.id, { onDelete: 'cascade' }),
    tagId: uuid('tag_id')
      .notNull()
      .references(() => crmTags.id, { onDelete: 'cascade' }),
    /** profiles.id; null = applied by the system. */
    appliedBy: uuid('applied_by'),
    appliedAt: timestamp('applied_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.contactId, t.tagId] }),
    tagIdx: index('crm_contact_tags_tag_idx').on(t.tagId),
  }),
);

/**
 * Per-org CRM preferences (one row per org). v1 holds `disabled_channels`
 * (channels the harvest skips). A missing row = all channels enabled.
 */
export const crmSettings = pgTable('crm_settings', {
  orgId: text('org_id').primaryKey(),
  value: jsonb('value').notNull().default({}),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Per-message sentiment (C2 groundwork). One row per scored inbound `messages`
 * row; accumulates so the monthly sentiment trend fills in over time. org_id
 * matches messages.org_id so it rides the same withOrgCore() GUC transaction.
 */
export const crmMessageSentiment = pgTable(
  'crm_message_sentiment',
  {
    orgId: text('org_id').notNull(),
    messageId: uuid('message_id').notNull(),
    score: doublePrecision('score').notNull(), // -1.0 (neg) … +1.0 (pos)
    label: text('label').notNull(), // 'positive' | 'neutral' | 'negative'
    model: text('model'),
    analyzedAt: timestamp('analyzed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.orgId, t.messageId] })],
);

/**
 * C3 — winning-conversation embeddings (dormant RAG groundwork). One row per
 * buyer (procedure-purchaser) conversation. The `embedding vector(1536)` column
 * is managed via raw SQL (pgvector, mirrors agent_memories) and is NOT modeled
 * here. similarWins() cosine-searches it for an active contact's nearest wins.
 */
export const crmWinEmbeddings = pgTable(
  'crm_win_embeddings',
  {
    orgId: text('org_id').notNull(),
    contactId: uuid('contact_id').notNull(),
    msgCount: integer('msg_count').notNull().default(0),
    bought: text('bought').array().notNull().default([]),
    snippet: text('snippet'),
    builtAt: timestamp('built_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.orgId, t.contactId] })],
);

export type CrmContact = typeof crmContacts.$inferSelect;
export type NewCrmContact = typeof crmContacts.$inferInsert;
export type CrmContactIdentity = typeof crmContactIdentities.$inferSelect;
export type CrmActivity = typeof crmActivities.$inferSelect;
export type CrmTag = typeof crmTags.$inferSelect;
export type CrmContactTag = typeof crmContactTags.$inferSelect;
