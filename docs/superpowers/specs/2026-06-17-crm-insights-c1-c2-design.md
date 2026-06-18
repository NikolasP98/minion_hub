# CRM Insights (C1 word cloud + C2 sentiment groundwork) — Design

**Date:** 2026-06-17
**Project:** minion_hub (SvelteKit 2 / Svelte 5 / Bun, Postgres `gxv` with org-GUC RLS)
**Origin:** CEO Renzo Granda's "aspirational" CRM feedback (the "C" set).

## Goal

Add a CRM **Insights** surface with two features driven by Renzo's feedback:

- **C1 — Most-used client words by date range** (a word cloud over inbound messages).
- **C2 — Consumer-sentiment trend**: begin scoring per-message sentiment now so a
  monthly trend becomes meaningful as data accumulates; show a current-period score
  and a trend chart that fills in over time.

**C3** (learn-from-winning-chats → similarity closing assist) is explicitly **deferred** —
see "Why C3 is deferred."

## Data reality (the binding constraint)

Validated against live `gxv` on 2026-06-17:

- **251 messages total, all in a single month** (2026-06-04 → 06-16); 160 inbound, 120 chats.
- C3 training set = **41 buyers with chat, 41 inbound messages** (~1 line each) — not enough
  to learn "winning conversations" from.
- `pgvector` IS installed (C3 is technically ready, just data-starved).

Root cause: WhatsApp history never backfilled into the ledger (Baileys serves history only at
fresh link), so the ledger holds ~12 days of forward-flow messages.

**Implication:** C1 works now and improves as data grows. C2's trend has one data point today,
so we build the *collection* (per-message sentiment scoring) now and let the chart fill in.
C3 stays designed-but-unbuilt until a real conversational corpus exists.

## Scope

In scope: C1 word cloud, C2 sentiment scoring + storage + current-score + monthly-trend chart,
the new Insights route/nav. Out of scope: C3, intake-form filters, any change to the gateway
message ledger schema, the WhatsApp backfill itself.

## Architecture

### Placement — new CRM → Insights tab

Add `{ id: 'insights', label: m.crm_nav_insights(), icon: Sparkles, href: '/crm/insights' }`
to `CrmNav.svelte` (Dashboard / Customers / **Insights** / Settings). New route
`src/routes/(app)/crm/insights/+page.{server,svelte}`.

Rationale: the CRM dashboard is already full; these are date-range analytics with their own
**message-date** filter (distinct from the dashboard's acquisition-date filter); and it is the
natural future home for C3. Keeps the dashboard load fast.

### Data viz — d3 (per user direction)

Use d3 for both visualizations to minimise boilerplate. New deps:
`d3-cloud`, `d3-scale`, `d3-shape` (+ `@types/d3-cloud`, `@types/d3-scale`, `@types/d3-shape`).
(`d3-force` and the low-level d3 modules are already installed from the overview graph.)

Render pattern: d3 **computes** layout/scales; **Svelte renders** the SVG from the computed
arrays (each-blocks), rather than letting d3 mutate the DOM — matches the overview-graph
approach and stays reactive/testable.

### C1 — word frequency (pure SQL, no LLM)

`src/server/services/crm-insights.service.ts`:

```ts
wordFrequency(ctx, { from, to, limit = 60 }): Promise<{ word: string; count: number }[]>
```

Postgres-native via `ts_stat` over `to_tsvector('spanish', body)` on inbound messages in the
range (Spanish stemming + stopword removal for free; English tail is negligible):

```sql
select word, nentry as count
from ts_stat($$
  select to_tsvector('spanish', coalesce(m.content,''))
  from messages m
  where m.org_id = current_setting('app.current_org_id', true)
    and m.direction = 'inbound' and m.is_bot is not true
    and coalesce(m.occurred_at, m.created_at) between :from and :to
$$)
where char_length(word) >= 3
order by nentry desc
limit :limit
```

(Message text lives in `messages.content`. The org-GUC scopes to the tenant; no
join to `crm_contact_identities` is needed for a tenant-wide word frequency.)

Valkey-cached (short TTL ~5m, key includes the date range) since message ingest does not bust
the CRM cache. A small extra stopword denylist (e.g. "hola","gracias","buenas") filtered in JS.

UI: `CrmWordCloud.svelte` — d3-cloud computes `{text,size,x,y,rotate}` for the top-N words
(font size scaled to count); Svelte renders positioned `<text>` in an SVG viewBox. Empty state
when no words.

### C2 — sentiment scoring + trend

**Storage** — new table `crm_message_sentiment`:

| col | type | notes |
|---|---|---|
| org_id | text | RLS GUC, FK-less (matches existing fin_/crm_ pattern) |
| message_id | uuid | PK with org_id; the ledger `messages.id` (uuid) |
| score | real | -1.0 (negative) … +1.0 (positive) |
| label | text | 'positive' | 'neutral' | 'negative' |
| model | text | model id used |
| analyzed_at | timestamptz | default now() |

org-GUC RLS forced (same `app_ledger`/`app.current_org_id` pattern as fin_/crm_ tables).
One migration at meta-repo root `supabase/migrations/`, applied to gxv via Supabase MCP.

**Scoring** — in `crm-insights.service.ts`:

```ts
scoreSentimentBatch(ctx, { cap = 50 }): Promise<{ scored: number }>
```

Selects inbound messages with non-empty `content` and **no** `crm_message_sentiment` row
(cap per run), sends them to OpenRouter in one batched JSON request (reuse the
funnel/analyze + tag/evaluate OpenRouter pattern), upserts one row per message. Failures are
swallowed (left unscored, retried next run) and never block the page.

**Trigger:** incremental-on-Insights-view (one capped batch per load, like the funnel
auto-analyze `$effect`) **plus** a manual "Analyze sentiment" button. No cron in v1.

**Aggregate:**

```ts
sentimentByMonth(ctx): Promise<{ month: string; avg: number; n: number }[]>
currentSentiment(ctx): Promise<{ avg: number; n: number } | null>  // trailing 30d
```

UI: `CrmSentimentTrend.svelte` — d3-scale (`scaleTime` x, `scaleLinear` y in [-1,1]) +
d3-shape (`line`, optional `area`) build the SVG path; Svelte renders path + axis ticks
(`scale.ticks()`). A header shows the current-period score; the chart is labeled
"based on N scored messages." Sparse now, fills in monthly.

## Data flow

```
Insights page load (server):
  parse ?from/?to (message-date range; default last 90d)
  → wordFrequency(range)            [cached]
  → sentimentByMonth() + currentSentiment()
  → (client, on mount) POST /api/crm/insights/sentiment  → scoreSentimentBatch(cap)
                                                          → invalidate on completion
```

Insights is **CRM-only** — no finance dependency.

## Components / files

- `src/routes/(app)/crm/insights/+page.server.ts` — loads word freq + sentiment aggregates.
- `src/routes/(app)/crm/insights/+page.svelte` — date-range control + both viz cards.
- `src/lib/components/crm/CrmWordCloud.svelte` — d3-cloud word cloud.
- `src/lib/components/crm/CrmSentimentTrend.svelte` — d3 line chart.
- `src/server/services/crm-insights.service.ts` — wordFrequency, scoreSentimentBatch,
  sentimentByMonth, currentSentiment.
- `src/routes/api/crm/insights/sentiment/+server.ts` — POST triggers a capped scoring batch.
- `src/lib/components/crm/crm-insights.ts` — pure helpers (stopword filter, month bucketing,
  label↔score mapping) — unit-tested.
- `src/lib/components/crm/CrmNav.svelte` — add Insights item.
- `supabase/migrations/<ts>_crm_message_sentiment.sql` (meta-repo root).
- i18n keys in `messages/{en,es}.json`.

## Error handling

- OpenRouter unavailable / malformed response → skip those messages (no row written),
  log once, return `{ scored: 0 }`; page still renders.
- Empty word frequency / no sentiment yet → friendly empty states.
- Date-range parse invalid → default to last 90 days.

## Testing

- `crm-insights.ts` pure helpers: stopword filtering, month bucketing, label↔score mapping,
  word-size scaling — vitest.
- Service SQL validated manually against gxv (word freq returns sensible Spanish tokens;
  sentiment upsert idempotent).
- `bun run check` 0/0, full `crm` + `services` suites green.

## Why C3 is deferred

C3 (RAG over winning buyer conversations) needs multi-turn conversations from buyers. Today
that corpus is 41 single-line messages. pgvector + `embeddings.ts` (OpenRouter, 1536-dim) are
ready, so C3 becomes a focused follow-up **once** the message corpus is rich (either organic
accumulation or solving the WhatsApp history backfill). Designing it now would be speculative.

## Migrations

1. `crm_message_sentiment` (additive, RLS forced) — applied to gxv via Supabase MCP.
