import { pgTable, uuid, text, jsonb, timestamp, index } from 'drizzle-orm/pg-core';

/**
 * Hub-native Support / Helpdesk — Minion's port of ERPNext's Issue + SLA
 * (erpnext/support). An Issue is a support ticket linked to the shared party
 * spine (and optionally a CRM contact), with SLA-derived response/resolution
 * deadlines.
 *
 * Tenancy: `org_id text` (== messages.org_id / crm_* / fin_* / sched_* /
 * parties), enforced by withOrgCore (role app_ledger + app.current_org_id GUC,
 * forced RLS). Policy/grants in the companion migration
 * `supabase/migrations/<ts>_support.sql` at the meta-repo root.
 *
 * ponytail: SLA is ONE per-org default config (support_settings jsonb), not
 * ERPNext's entity-tiered (Customer → Group → Territory) SLA entity. Deadlines
 * are now()+minutes, not working-hours/holiday-aware. Both are real ERPNext
 * features; add the tiered SLA table + a business-calendar only if a customer
 * needs per-tier guarantees. Threaded replies are v2 — v1 tracks status + timers
 * (the conversation already lives in the message ledger).
 */
export const supportIssues = pgTable(
  'support_issues',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: text('org_id').notNull(),
    /** Human-readable ID (TKT-2026-00042), stamped at create. See naming-series.ts. */
    humanId: text('human_id'),
    subject: text('subject').notNull(),
    description: text('description'),
    /** open | replied | on_hold | resolved | closed */
    status: text('status').notNull().default('open'),
    /** low | medium | high | urgent — keys into support_settings.priorities */
    priority: text('priority').notNull().default('medium'),
    /** Soft bridge to the shared party spine (parties.id). */
    partyId: uuid('party_id'),
    /** Soft bridge to the originating CRM contact (crm_contacts.id). */
    crmContactId: uuid('crm_contact_id'),
    /** Assigned hub user (profiles.id). */
    ownerId: uuid('owner_id'),
    /** 'manual' | 'whatsapp' | 'telegram' | … — how the ticket arrived. */
    source: text('source').notNull().default('manual'),
    channel: text('channel'),
    /** SLA deadlines, stamped at create time from support_settings. */
    responseBy: timestamp('response_by', { withTimezone: true }),
    resolutionBy: timestamp('resolution_by', { withTimezone: true }),
    firstRespondedAt: timestamp('first_responded_at', { withTimezone: true }),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    metadata: jsonb('metadata').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    orgStatusIdx: index('support_issues_org_status_idx').on(t.orgId, t.status),
    orgCreatedIdx: index('support_issues_org_created_idx').on(t.orgId, t.createdAt),
    partyIdx: index('support_issues_party_idx').on(t.partyId),
    contactIdx: index('support_issues_contact_idx').on(t.crmContactId),
    ownerIdx: index('support_issues_owner_idx').on(t.ownerId),
  }),
);

/**
 * Per-org Support preferences (one row per org). v1 holds the default SLA
 * (`priorities` → per-priority response/resolution minutes) + defaultPriority.
 * A missing row = the built-in DEFAULT_SLA. Mirrors crm_settings.
 */
export const supportSettings = pgTable('support_settings', {
  orgId: text('org_id').primaryKey(),
  value: jsonb('value').notNull().default({}),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type SupportIssue = typeof supportIssues.$inferSelect;
export type NewSupportIssue = typeof supportIssues.$inferInsert;
export type SupportSettings = typeof supportSettings.$inferSelect;
