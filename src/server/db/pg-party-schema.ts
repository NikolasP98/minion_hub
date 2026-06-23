import { pgTable, uuid, text, jsonb, timestamp, index } from 'drizzle-orm/pg-core';

/**
 * Party — the canonical "someone you do business with" (person or company),
 * the shared spine the per-module facets point at.
 *
 * Today the same human exists three times: a `crm_contacts` row (channel
 * harvest), a `fin_clients` row (SUSII sync), and a `sched_bookings` attendee —
 * stitched together only at query time by a last-9-digits phone match
 * (crm-finance.service.ts) and soft FKs. `parties` promotes that match from a
 * query hint to an identity: each facet gains a nullable `party_id` (added in
 * the companion migration to crm_contacts / fin_clients / sched_bookings), and
 * the dedup logic that used to JOIN now CREATES/links a party (party.service.ts).
 *
 * Tenancy: `org_id text` (== messages.org_id / crm_* / fin_* / sched_*),
 * enforced by `withOrgCore` (role app_ledger + app.current_org_id GUC, forced
 * RLS). Policy/grants live in the hand-written companion migration
 * `supabase/migrations/<ts>_party.sql` at the meta-repo root — Drizzle never
 * manages roles/policies and we never db:push the core DB.
 *
 * ponytail: no `party_links` polymorphic table — the facets carry a direct
 * `party_id` column. Add a link table only if a party ever needs >1 row of the
 * same facet kind, which it doesn't today.
 */
export const parties = pgTable(
  'parties',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: text('org_id').notNull(),
    /** Intrinsic nature: 'person' | 'company' | 'agent'. Role (customer/worker/…)
     *  is NOT here — it is emergent from which facet links the party. */
    type: text('type').notNull().default('person'),
    name: text('name'),
    /** Set ⇔ type='agent': the backing gateway agent id. The agent's archetype
     *  (copilot/brain/autonomous) is resolved from the gateway, never copied here. */
    agentId: text('agent_id'),
    /** Normalized last-9-digits phone (Peru) — the dedup key shared with the CRM
     *  phone bridge. Null when a party is keyed only by document. */
    phone9: text('phone9'),
    email: text('email'),
    /** RUC/DNI — the finance link key. */
    docType: text('doc_type'),
    docNumber: text('doc_number'),
    metadata: jsonb('metadata').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    orgIdx: index('parties_org_idx').on(t.orgId),
    // Identity = doc_number (DNI/RUC): permanent + unique per person, the ONLY
    // uniquely-enforced key (partial-unique in the companion .sql). phone9 is a
    // BRIDGE not an identity — shared/reassigned in Peru, so NON-unique here.
    phoneIdx: index('parties_org_phone9_idx').on(t.orgId, t.phone9),
    docIdx: index('parties_org_doc_idx').on(t.orgId, t.docNumber),
    // One party per gateway agent (partial-unique in the companion .sql).
    agentIdx: index('parties_org_agent_idx').on(t.orgId, t.agentId),
  }),
);

export type Party = typeof parties.$inferSelect;
export type NewParty = typeof parties.$inferInsert;
