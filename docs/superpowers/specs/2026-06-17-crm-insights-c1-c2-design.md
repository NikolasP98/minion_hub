# CRM Insights (C1 word cloud + C2 sentiment groundwork) — Design

**Date:** 2026-06-17
**Performance contract updated:** 2026-08-25
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
so we build the _collection_ (per-message sentiment scoring) now and let the chart fill in.
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

### C1 — word frequency (Postgres daily rollup, no live tokenization)

`src/server/services/crm-word-frequency-rollup.service.ts`:

```ts
wordFrequencyRollup(ctx, { fromIso, toIso, limit = 60 }): Promise<{ word: string; count: number }[]>
```

`crm_word_frequency_daily` stores per-org, per-UTC-day document frequency for inbound,
non-bot messages. The scheduled refresh tokenizes changed days with Postgres
`to_tsvector('simple', content)` and `tsvector_to_array`; the interactive RLS request only
sums the bounded daily rows:

```sql
select word, sum(document_count)::int as count
from crm_word_frequency_daily
where org_id = current_setting('app.current_org_id', true)
  and day between :from_utc_day and :to_utc_day
group by word
order by sum(document_count) desc
limit :limit
```

The refresh endpoint runs a rolling three-day rebuild every 15 minutes and a bounded
4,000-day rebuild at 08:15 UTC. It requires Vercel's `CRON_SECRET`. Message text is never
tokenized on the live request path, and DuckDB is not part of an RLS request.

The page loads one `crmInsightsDashboard` snapshot, Valkey-cached for 5 minutes with a
30-minute stale-while-revalidate window. Its stable key contains only the org, selected range,
and sentiment granularity; rolling ISO timestamps do not create one-off cache keys. A small
Spanish/English chat-noise denylist is still filtered in JS.

UI: `CrmWordCloud.svelte` — d3-cloud computes `{text,size,x,y,rotate}` for the top-N words
(font size scaled to count); Svelte renders positioned `<text>` in an SVG viewBox. Empty state
when no words.

### C2 — sentiment scoring + trend

**Storage** — new table `crm_message_sentiment`:

| col         | type        | notes                                                 |
| ----------- | ----------- | ----------------------------------------------------- |
| org_id      | text        | RLS GUC, FK-less (matches existing fin_/crm_ pattern) |
| message_id  | uuid        | PK with org_id; the ledger `messages.id` (uuid)       |
| score       | real        | -1.0 (negative) … +1.0 (positive)                     |
| label       | text        | `positive` \| `neutral` \| `negative`                 |
| model       | text        | model id used                                         |
| analyzed_at | timestamptz | default now()                                         |

org-GUC RLS forced (same `app_ledger`/`app.current_org_id` pattern as fin_/crm_ tables).
One migration at meta-repo root `supabase/migrations/`, applied to gxv via Supabase MCP.

**Scoring** — in `crm-insights.service.ts`:

```ts
scoreSentimentBatch(ctx, { cap = 50 }): Promise<{ scored: number }>
```

Selects up to `cap` unscored chat-days, preserving each chat-day's inbound message order, and
sends those grouped conversations to OpenRouter in one batched JSON request (reuse the
funnel/analyze + tag/evaluate OpenRouter pattern). One conversation score is fanned out to
every message row in that chat-day. This preserves the per-message storage contract while
making the customer's daily conversation the scoring unit and bounding model tokens. Failures
are swallowed (left unscored, retried next run) and never block the page.

**Trigger:** incremental-on-Insights-view (one capped batch per load, like the funnel
auto-analyze `$effect`) **plus** a manual "Analyze sentiment" button. A successful scoring
batch refreshes only its affected org/day range and invalidates the org CRM cache. The same
cron that refreshes word frequency also refreshes the rolling sentiment window.

**Aggregate:**

```ts
sentimentByDayRollup(ctx, { granularity }): Promise<{ day: string; avg: number; n: number }[]>
currentSentiment(ctx): Promise<{ avg: number; n: number } | null>  // trailing 30d
```

Historical trend reads come from `crm_sentiment_chat_daily`: message scores first average
within a chat-day, then those rows aggregate by day/week/month so chatty customers do not
dominate the trend. The interactive request never recomputes the historic message join.

UI: `CrmSentimentTrend.svelte` — d3-scale (`scaleTime` x, `scaleLinear` y in [-1,1]) +
d3-shape (`line`, optional `area`) build the SVG path; Svelte renders path + axis ticks
(`scale.ticks()`). A header shows the current-period score; the chart is labeled
"based on N scored messages." Sparse now, fills in monthly.

## Data flow

```
Insights page load (server):
  parse ?range + ?sent (default last 90d + day granularity)
  → crmInsightsDashboard(range, granularity) [stable Valkey snapshot]
      → wordFrequencyRollup(range) + sentimentByDayRollup(granularity)
      → currentSentiment() + the existing Insights aggregates
  → (client, on mount) POST /api/crm/insights/sentiment
      → scoreSentimentBatch(cap)
      → refresh affected sentiment rollup days + invalidate CRM cache
```

Insights is **CRM-only** — no finance dependency.

## Components / files

- `src/routes/(app)/crm/insights/+page.server.ts` — loads word freq + sentiment aggregates.
- `src/routes/(app)/crm/insights/+page.svelte` — date-range control + both viz cards.
- `src/lib/components/crm/CrmWordCloud.svelte` — d3-cloud word cloud.
- `src/lib/components/crm/CrmSentimentTrend.svelte` — d3 line chart.
- `src/server/services/crm-insights-dashboard.service.ts` — stable cached page snapshot.
- `src/server/services/crm-word-frequency-rollup.service.ts` — bounded daily word reads and refresh.
- `src/server/services/crm-sentiment-rollup.service.ts` — chat-day trend reads and refresh.
- `src/server/services/crm-insights.service.ts` — scoreSentimentBatch and currentSentiment.
- `src/routes/api/crm/insights/sentiment/+server.ts` — POST triggers a capped scoring batch.
- `src/routes/api/crm/insights/word-frequency/refresh/+server.ts` — authenticated rollup cron.
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
- Service coverage verifies stable dashboard keys, rollup queries, bounded refreshes, and
  sentiment upsert/idempotency behavior.
- `bun run check` 0/0, full `crm` + `services` suites green.

## Why C3 is deferred

C3 (RAG over winning buyer conversations) needs multi-turn conversations from buyers. Today
that corpus is 41 single-line messages. pgvector + `embeddings.ts` (OpenRouter, 1536-dim) are
ready, so C3 becomes a focused follow-up **once** the message corpus is rich (either organic
accumulation or solving the WhatsApp history backfill). Designing it now would be speculative.

## Migrations

1. `crm_message_sentiment` (additive, RLS forced) — applied to gxv via Supabase MCP.
2. `crm_word_frequency_daily` and `crm_sentiment_chat_daily` (additive, RLS forced), plus
   cold-path indexes and their refresh functions.
