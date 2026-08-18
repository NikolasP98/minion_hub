import {
  pgTable,
  uuid,
  text,
  integer,
  doublePrecision,
  boolean,
  timestamp,
  index,
} from 'drizzle-orm/pg-core';

/**
 * Per-call LLM usage ledger — the metering substrate for pricing.
 *
 * Every hub LLM call funnels through `getOpenRouterModel()` in `$server/llm`,
 * which wraps the model in a usage-recording middleware. That single chokepoint
 * is why this table can claim complete coverage: there is no second provider
 * factory and no direct `createOpenAI(...)` call site left in `src/`.
 *
 * WHY THIS EXISTS: until now the hub had no usage/quota/credit/billing table
 * anywhere — not in Turso, not in the Supabase migrations. Cost per tenant was
 * unknown, so no price could be defended. This is the instrumentation window.
 *
 * BILLING TRUTH: `provider_cost_usd` is what OpenRouter actually charged (from
 * the provider's own `usage` payload). `cost_usd` is OUR estimate from the local
 * price table. Prefer the provider number wherever it is present — a local price
 * table silently goes stale (it already did: `claude-opus-5` had no entry and so
 * billed as zero), whereas the provider figure cannot.
 *
 * NOT org-FK'd on purpose: usage rows must outlive the organization they
 * describe, otherwise deleting a tenant erases the evidence for their last
 * invoice. `org_id` is plain text to match `messages.org_id` / the CRM tables.
 *
 * RLS: enabled + forced with NO policies — deny-all for every non-bypass role.
 * Only the service role reads this (admin cost dashboards, billing rollups); it
 * is never exposed to a tenant-scoped RLS session.
 */
export const aiUsage = pgTable(
  'ai_usage',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Resolved tenant. Null = platform-internal call with no tenant in scope. */
    orgId: text('org_id'),
    /** SvelteKit route id (e.g. `/api/crm/tags/[id]/evaluate`) — feature attribution. */
    route: text('route'),
    /** Logical pipeline/feature label. Set explicitly by cron pipelines; else derived from route. */
    feature: text('feature'),
    /** Full model id as sent to the provider, e.g. `google/gemini-2.5-flash`. */
    model: text('model').notNull(),

    /** Non-cached input tokens (what you pay full input rate for). */
    inputTokens: integer('input_tokens').notNull().default(0),
    /** Cached input tokens READ back (billed ~0.1x input on Anthropic, 0.25x elsewhere). */
    cacheReadTokens: integer('cache_read_tokens').notNull().default(0),
    /** Cached input tokens WRITTEN (billed 1.25x–2x input — the cost of seeding a cache). */
    cacheWriteTokens: integer('cache_write_tokens').notNull().default(0),
    /** Completion tokens. */
    outputTokens: integer('output_tokens').notNull().default(0),
    /** Reasoning tokens, where the model reports them separately (billed as output). */
    reasoningTokens: integer('reasoning_tokens').notNull().default(0),

    /** Our estimate from `$lib/utils/model-pricing`. Always populated; may be wrong. */
    costUsd: doublePrecision('cost_usd').notNull().default(0),
    /** Provider-reported actual cost, when the provider returns one. Authoritative. */
    providerCostUsd: doublePrecision('provider_cost_usd'),

    durationMs: integer('duration_ms'),
    /** False when the call threw — failed calls still burn input tokens upstream. */
    ok: boolean('ok').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // The billing rollup: "what did org X cost me this period".
    index('ai_usage_org_created_idx').on(t.orgId, t.createdAt),
    // The abuse/runaway query: "what is burning money right now", org-independent.
    index('ai_usage_created_idx').on(t.createdAt),
  ],
);

export type AiUsageRow = typeof aiUsage.$inferSelect;
export type AiUsageInsert = typeof aiUsage.$inferInsert;
