# CRM Insights (C1 word cloud + C2 sentiment groundwork) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a CRM → Insights tab with a d3-cloud word cloud of clients' most-used words by date range, plus per-message sentiment scoring whose monthly trend (d3 line chart) fills in over time.

**Architecture:** New route `/crm/insights` loads a pure-SQL word frequency (`ts_stat` over `to_tsvector('spanish', messages.content)`) and sentiment aggregates; sentiment is scored incrementally via OpenRouter into a new `crm_message_sentiment` table. d3 computes layout/scales; Svelte renders the SVG. All reads route through `withOrgCore` (org-GUC RLS).

**Tech Stack:** SvelteKit 2, Svelte 5 runes, Bun, Postgres (gxv) + Drizzle, `@minion-stack/cache` (Valkey), `ai` SDK + `@ai-sdk/openai` (OpenRouter), d3-cloud + d3-scale + d3-shape.

## Global Constraints

- TypeScript strict; no `any`, no `@ts-nocheck`. `bun run check` must stay 0 errors / 0 warnings.
- Svelte 5 runes only (`$props`, `$state`, `$derived`, `$effect`); `onclick={}`; `Snippet` for children.
- Every core-DB read/write routes through `withOrgCore(ctx, (tx) => …)`. NEVER `getCoreDb()` for tenant data (bypasses RLS).
- i18n: add keys to BOTH `messages/en.json` and `messages/es.json`; run `bun run i18n:compile` after editing (paraglide `src/lib/paraglide` is gitignored & regenerated) or `check` fails on missing message functions.
- Cache: `keys.hub(name, { t, d })` descriptors must be `Record<string,string|number>` — use `scopeData()` from `src/server/services/base.ts` to drop undefined.
- Message text column is `messages.content` (NOT `body`); `messages.id` is `uuid`. Relevant cols: `org_id text, channel text, chat_id text, direction text ('inbound'|'outbound'), is_bot boolean, content text, occurred_at timestamptz, created_at timestamptz`.
- Migrations are hand-written idempotent SQL at meta-repo root `supabase/migrations/<ts>_<name>.sql`, applied to gxv via Supabase MCP `apply_migration`. NEVER drizzle-kit push the core DB. Use a timestamp AFTER `20260617150000` (e.g. `20260617160000`).
- OpenRouter model resolution mirrors the funnel endpoint: `env.CRM_SENTIMENT_MODEL || env.CRM_FUNNEL_MODEL || env.NOTES_POLISH_MODEL || 'google/gemini-2.5-flash'`. Base URL `https://openrouter.ai/api/v1`. Missing key → feature degrades, never throws to the page.
- C3 (RAG over winning chats) is OUT OF SCOPE.

---

### Task 1: Schema + migration for `crm_message_sentiment`

**Files:**
- Modify: `minion_hub/src/server/db/pg-crm-schema.ts` (append a table)
- Create: `supabase/migrations/20260617160000_crm_message_sentiment.sql` (meta-repo root)

**Interfaces:**
- Produces: drizzle table `crmMessageSentiment` with columns `orgId, messageId (uuid), score (doublePrecision), label (text), model (text), analyzedAt (timestamptz)`; PK `(orgId, messageId)`. Physical table `crm_message_sentiment` on gxv.

- [ ] **Step 1: Append the drizzle table to `pg-crm-schema.ts`**

At the end of `minion_hub/src/server/db/pg-crm-schema.ts` add:

```ts
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
```

(`pgTable`, `text`, `uuid`, `doublePrecision`, `timestamp`, `primaryKey` are already imported at the top of the file.)

- [ ] **Step 2: Write the migration SQL**

Create `supabase/migrations/20260617160000_crm_message_sentiment.sql`:

```sql
-- CRM per-message sentiment (C2 groundwork). One row per scored inbound message;
-- the monthly sentiment trend aggregates these. Tenancy: org_id text + app_ledger
-- role + app.current_org_id GUC (same as crm_/fin_ tables). Idempotent.

create table if not exists public.crm_message_sentiment (
  org_id      text not null,
  message_id  uuid not null,
  score       double precision not null,
  label       text not null,
  model       text,
  analyzed_at timestamptz not null default now(),
  primary key (org_id, message_id)
);
--> statement-breakpoint
create index if not exists crm_message_sentiment_org_time_idx
  on public.crm_message_sentiment (org_id, analyzed_at);
--> statement-breakpoint
grant select, insert, update, delete on public.crm_message_sentiment to app_ledger;
--> statement-breakpoint
alter table public.crm_message_sentiment enable row level security;
--> statement-breakpoint
alter table public.crm_message_sentiment force  row level security;
--> statement-breakpoint
create policy crm_message_sentiment_org_guc on public.crm_message_sentiment
  for all using (org_id = current_setting('app.current_org_id', true))
          with check (org_id = current_setting('app.current_org_id', true));
```

- [ ] **Step 3: Apply the migration to gxv**

Apply via Supabase MCP `apply_migration` (project gxv `gxvsaskbohavnurfvshr`), name `crm_message_sentiment`, body = the SQL above. Then verify:

Run (psql via `$SUPABASE_DB_URL` in `minion_hub/.env.local`):
`select count(*) from public.crm_message_sentiment;`
Expected: `0` (table exists, empty).

- [ ] **Step 4: Type-check**

Run: `cd minion_hub && bun run check`
Expected: 0 errors, 0 warnings.

- [ ] **Step 5: Commit**

```bash
cd /home/nikolas/Documents/CODE/MINION
git -C minion_hub add src/server/db/pg-crm-schema.ts
git add supabase/migrations/20260617160000_crm_message_sentiment.sql
git -C minion_hub commit -m "feat(crm): crm_message_sentiment table (C2 groundwork)"
```
(The migration lives in the meta-repo, the schema in the hub repo — two commits if needed.)

---

### Task 2: Pure helpers `crm-insights.ts` + tests

**Files:**
- Create: `minion_hub/src/lib/components/crm/crm-insights.ts`
- Test: `minion_hub/src/lib/components/crm/crm-insights.test.ts`

**Interfaces:**
- Produces:
  - `EXTRA_STOPWORDS: Set<string>` and `isStopword(word: string): boolean`
  - `monthKey(d: Date): string` → `'YYYY-MM'`
  - `scoreToLabel(score: number): 'positive' | 'neutral' | 'negative'` (≥0.25 positive, ≤-0.25 negative, else neutral)
  - `wordSize(count: number, min: number, max: number, range?: [number, number]): number` (sqrt scale, default range [12, 48])

- [ ] **Step 1: Write the failing test**

`minion_hub/src/lib/components/crm/crm-insights.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { isStopword, monthKey, scoreToLabel, wordSize } from './crm-insights';

describe('isStopword', () => {
  it('filters common chat noise (case-insensitive)', () => {
    expect(isStopword('Hola')).toBe(true);
    expect(isStopword('gracias')).toBe(true);
    expect(isStopword('rinoplastia')).toBe(false);
  });
});

describe('monthKey', () => {
  it('formats a date as YYYY-MM (UTC)', () => {
    expect(monthKey(new Date('2026-06-15T10:00:00Z'))).toBe('2026-06');
    expect(monthKey(new Date('2026-01-01T00:00:00Z'))).toBe('2026-01');
  });
});

describe('scoreToLabel', () => {
  it('buckets sentiment scores', () => {
    expect(scoreToLabel(0.8)).toBe('positive');
    expect(scoreToLabel(0.25)).toBe('positive');
    expect(scoreToLabel(0)).toBe('neutral');
    expect(scoreToLabel(-0.24)).toBe('neutral');
    expect(scoreToLabel(-0.5)).toBe('negative');
  });
});

describe('wordSize', () => {
  it('sqrt-scales counts into the px range, clamped', () => {
    expect(wordSize(1, 1, 1)).toBe(12); // min==max → low end
    expect(wordSize(100, 1, 100)).toBe(48); // max → high end
    const mid = wordSize(25, 1, 100);
    expect(mid).toBeGreaterThan(12);
    expect(mid).toBeLessThan(48);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd minion_hub && bun run vitest run src/lib/components/crm/crm-insights.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `crm-insights.ts`**

```ts
/** Pure helpers for CRM Insights (word cloud + sentiment). No I/O, no paraglide. */

/** Common Spanish/English chat noise that `ts_stat('spanish')` does not strip. */
export const EXTRA_STOPWORDS = new Set<string>([
  'hola', 'buenas', 'buenos', 'dias', 'tardes', 'noches', 'gracias', 'ok', 'okay',
  'si', 'no', 'porfa', 'porfavor', 'favor', 'saludos', 'hello', 'hi', 'yes', 'please', 'thanks',
]);
export function isStopword(word: string): boolean {
  return EXTRA_STOPWORDS.has(word.trim().toLowerCase());
}

/** UTC year-month key, e.g. '2026-06'. */
export function monthKey(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** Map a [-1,1] sentiment score to a label. */
export function scoreToLabel(score: number): 'positive' | 'neutral' | 'negative' {
  if (score >= 0.25) return 'positive';
  if (score <= -0.25) return 'negative';
  return 'neutral';
}

/** Sqrt-scale a frequency count into a font-size px range (clamped). */
export function wordSize(count: number, min: number, max: number, range: [number, number] = [12, 48]): number {
  const [lo, hi] = range;
  if (max <= min) return lo;
  const t = Math.sqrt((count - min) / (max - min));
  return Math.round(lo + t * (hi - lo));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd minion_hub && bun run vitest run src/lib/components/crm/crm-insights.test.ts`
Expected: PASS (all 4 describe blocks).

- [ ] **Step 5: Commit**

```bash
cd minion_hub && git add src/lib/components/crm/crm-insights.ts src/lib/components/crm/crm-insights.test.ts
git commit -m "feat(crm): pure helpers for Insights (stopwords, month key, sentiment label, word size)"
```

---

### Task 3: `crm-insights.service.ts` — `wordFrequency`

**Files:**
- Create: `minion_hub/src/server/services/crm-insights.service.ts`

**Interfaces:**
- Consumes: `withOrgCore` (`$server/db/with-org-core`), `cached, keys, tags` (`@minion-stack/cache`), `scopeData` (`./base`), `isStopword` (Task 2).
- Produces: `wordFrequency(ctx: CoreCtx, opts: { fromIso: string; toIso: string; limit?: number }): Promise<{ word: string; count: number }[]>`

- [ ] **Step 1: Implement `wordFrequency`**

`minion_hub/src/server/services/crm-insights.service.ts`:

```ts
import { sql } from 'drizzle-orm';
import { withOrgCore } from '$server/db/with-org-core';
import type { CoreCtx } from '$server/auth/core-ctx';
import { cached, keys, tags } from '@minion-stack/cache';
import { scopeData } from './base';
import { isStopword } from '$lib/components/crm/crm-insights';

const insightsTags = (orgId: string) => tags.tenantDomain(orgId, 'crm');

/**
 * Most-used words in inbound client messages over a date range. Postgres-native
 * frequency via ts_stat over to_tsvector('spanish', content) — Spanish stemming
 * + stopword removal for free; an extra denylist trims chat noise. Cached 5m by
 * range (message ingest does not bust the CRM cache, and word freq is not
 * real-time critical). from/to are pre-validated ISO timestamps; limit is an int.
 */
export function wordFrequency(
  ctx: CoreCtx,
  opts: { fromIso: string; toIso: string; limit?: number },
): Promise<{ word: string; count: number }[]> {
  const limit = Math.min(200, Math.max(10, Math.floor(opts.limit ?? 80)));
  return cached(
    keys.hub('crm-wordfreq', { t: ctx.tenantId, d: scopeData({ from: opts.fromIso, to: opts.toIso, limit }) }),
    { ttl: '5m', swr: '1m', tags: [...insightsTags(ctx.tenantId)] },
    () =>
      withOrgCore(ctx, async (tx) => {
        // ts_stat's argument is a literal SQL string; the org is scoped by the GUC
        // inside the withOrgCore tx, and from/to/limit are app-validated (ISO + int),
        // so inlining them here is safe (no user free-text reaches this string).
        const inner = `select to_tsvector('spanish', coalesce(content,'')) from messages
          where org_id = current_setting('app.current_org_id', true)
            and direction = 'inbound' and is_bot is not true
            and coalesce(occurred_at, created_at) >= '${opts.fromIso}'::timestamptz
            and coalesce(occurred_at, created_at) <= '${opts.toIso}'::timestamptz`;
        const rows = (await tx.execute(sql`
          select word, nentry::int as count
          from ts_stat(${inner})
          where char_length(word) >= 3
          order by nentry desc
          limit ${sql.raw(String(limit * 2))}
        `)) as unknown as Array<{ word: string; count: number }>;
        return rows
          .map((r) => ({ word: String(r.word), count: Number(r.count) }))
          .filter((r) => !isStopword(r.word))
          .slice(0, limit);
      }),
  );
}
```

(`scopeData` exists in `src/server/services/base.ts`; `CoreCtx` is exported by `$server/auth/core-ctx`. Confirm both imports resolve — they are used by `crm-finance.service.ts`.)

- [ ] **Step 2: Validate the SQL against gxv**

Run (psql via `$SUPABASE_DB_URL`), substituting the org GUC manually to mimic `withOrgCore`:
```sql
set local "app.current_org_id" = '21e0601b-f632-43fd-8414-d644af4271f4';
select word, nentry from ts_stat($$
  select to_tsvector('spanish', coalesce(content,'')) from messages
  where org_id = current_setting('app.current_org_id', true)
    and direction='inbound' and is_bot is not true
$$) where char_length(word) >= 3 order by nentry desc limit 15;
```
Expected: a ranked list of Spanish word stems (e.g. treatment terms), no error.

- [ ] **Step 3: Type-check**

Run: `cd minion_hub && bun run check`
Expected: 0 errors, 0 warnings.

- [ ] **Step 4: Commit**

```bash
cd minion_hub && git add src/server/services/crm-insights.service.ts
git commit -m "feat(crm): wordFrequency service (ts_stat over spanish tsvector, cached)"
```

---

### Task 4: `crm-insights.service.ts` — sentiment scoring + aggregates + API route

**Files:**
- Modify: `minion_hub/src/server/services/crm-insights.service.ts`
- Create: `minion_hub/src/routes/api/crm/insights/sentiment/+server.ts`

**Interfaces:**
- Consumes: `crmMessageSentiment` (Task 1), `scoreToLabel`, `monthKey` (Task 2), `withOrgCore`, `getCoreCtx`.
- Produces:
  - `scoreSentimentBatch(ctx: CoreCtx, opts?: { cap?: number }): Promise<{ scored: number }>`
  - `sentimentByMonth(ctx: CoreCtx): Promise<{ month: string; avg: number; n: number }[]>`
  - `currentSentiment(ctx: CoreCtx): Promise<{ avg: number; n: number } | null>` (trailing 30d)
  - `POST /api/crm/insights/sentiment` → `{ scored }`

- [ ] **Step 1: Add sentiment functions to `crm-insights.service.ts`**

First MERGE these imports into the existing top-of-file import block (imports must stay top-level — do NOT append them at the bottom):

```ts
import { generateText } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { env } from '$env/dynamic/private';
import { scoreToLabel } from '$lib/components/crm/crm-insights';
```

Then add the constants + functions at the end of the file:

```ts
const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';
const SENTIMENT_MODEL =
  env.CRM_SENTIMENT_MODEL || env.CRM_FUNNEL_MODEL || env.NOTES_POLISH_MODEL || 'google/gemini-2.5-flash';

/**
 * Score sentiment for inbound messages that don't yet have a sentiment row.
 * Batched single OpenRouter call returning per-message scores in [-1,1].
 * Failures are swallowed (messages stay unscored, retried next run) so the
 * page never breaks. Returns how many rows were written.
 */
export async function scoreSentimentBatch(ctx: CoreCtx, opts?: { cap?: number }): Promise<{ scored: number }> {
  const cap = Math.min(100, Math.max(1, Math.floor(opts?.cap ?? 50)));
  const apiKey = env.OPENROUTER_API_KEY;
  if (!apiKey) return { scored: 0 };

  const pending = await withOrgCore(ctx, async (tx) => {
    return (await tx.execute(sql`
      select m.id::text as id, m.content
      from messages m
      where m.org_id = current_setting('app.current_org_id', true)
        and m.direction = 'inbound' and m.is_bot is not true
        and m.content is not null and length(trim(m.content)) > 0
        and not exists (
          select 1 from crm_message_sentiment s
          where s.org_id = m.org_id and s.message_id = m.id
        )
      order by coalesce(m.occurred_at, m.created_at) desc
      limit ${sql.raw(String(cap))}
    `)) as unknown as Array<{ id: string; content: string }>;
  });
  if (pending.length === 0) return { scored: 0 };

  const openrouter = createOpenAI({ apiKey, baseURL: OPENROUTER_BASE_URL });
  const transcript = pending.map((m, i) => `${i + 1}. ${m.content.slice(0, 400).replace(/\n/g, ' ')}`).join('\n');
  const prompt = `You score the SENTIMENT of customer messages to a Peruvian aesthetics clinic (mostly Spanish). For each numbered message return a score in [-1, 1]: -1 very negative/upset, 0 neutral/informational, 1 very positive/enthusiastic.

Return ONLY a JSON array of objects in the same order: [{"i":1,"score":0.0}, ...]. No prose.

Messages:
${transcript}`;

  let scores: Array<{ i: number; score: number }> = [];
  try {
    const res = await generateText({ model: openrouter(SENTIMENT_MODEL), prompt, temperature: 0 });
    const match = res.text.match(/\[[\s\S]*\]/);
    if (match) {
      const parsed = JSON.parse(match[0]) as unknown;
      if (Array.isArray(parsed)) {
        scores = parsed
          .map((p) => p as { i?: unknown; score?: unknown })
          .filter((p) => typeof p.i === 'number' && typeof p.score === 'number')
          .map((p) => ({ i: p.i as number, score: Math.max(-1, Math.min(1, p.score as number)) }));
      }
    }
  } catch {
    return { scored: 0 }; // leave unscored; retried next run
  }
  if (scores.length === 0) return { scored: 0 };

  const rows = scores
    .filter((s) => s.i >= 1 && s.i <= pending.length)
    .map((s) => ({ id: pending[s.i - 1].id, score: s.score, label: scoreToLabel(s.score) }));
  if (rows.length === 0) return { scored: 0 };

  await withOrgCore(ctx, async (tx) => {
    const values = sql.join(
      rows.map(
        (r) =>
          sql`(current_setting('app.current_org_id', true), ${r.id}::uuid, ${r.score}, ${r.label}, ${SENTIMENT_MODEL})`,
      ),
      sql`, `,
    );
    await tx.execute(sql`
      insert into crm_message_sentiment (org_id, message_id, score, label, model)
      values ${values}
      on conflict (org_id, message_id) do nothing
    `);
  });
  return { scored: rows.length };
}

/** Monthly average sentiment (chronological). */
export function sentimentByMonth(ctx: CoreCtx): Promise<{ month: string; avg: number; n: number }[]> {
  return withOrgCore(ctx, async (tx) => {
    const rows = (await tx.execute(sql`
      select to_char(date_trunc('month', s.analyzed_at), 'YYYY-MM') as month,
             avg(s.score)::float8 as avg, count(*)::int as n
      from crm_message_sentiment s
      where s.org_id = current_setting('app.current_org_id', true)
      group by 1 order by 1
    `)) as unknown as Array<{ month: string; avg: number; n: number }>;
    return rows.map((r) => ({ month: String(r.month), avg: Number(r.avg), n: Number(r.n) }));
  });
}

/** Trailing-30d average sentiment, or null when nothing scored. */
export function currentSentiment(ctx: CoreCtx): Promise<{ avg: number; n: number } | null> {
  return withOrgCore(ctx, async (tx) => {
    const [r] = (await tx.execute(sql`
      select avg(s.score)::float8 as avg, count(*)::int as n
      from crm_message_sentiment s
      where s.org_id = current_setting('app.current_org_id', true)
        and s.analyzed_at >= now() - interval '30 days'
    `)) as unknown as Array<{ avg: number | null; n: number }>;
    if (!r || Number(r.n) === 0) return null;
    return { avg: Number(r.avg ?? 0), n: Number(r.n) };
  });
}
```

Note: `monthKey` (Task 2) is used by the UI for client-side gap-filling, not here; the SQL buckets by `date_trunc`. Keep the Task 2 import in the UI, not this file.

- [ ] **Step 2: Create the API route**

`minion_hub/src/routes/api/crm/insights/sentiment/+server.ts`:

```ts
import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { getCoreCtx } from '$server/auth/core-ctx';
import { scoreSentimentBatch } from '$server/services/crm-insights.service';

/** POST /api/crm/insights/sentiment → score one capped batch of unscored inbound messages. */
export const POST: RequestHandler = async ({ locals }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401, 'Authentication required');
  const result = await scoreSentimentBatch(ctx, { cap: 50 });
  return json(result);
};
```

- [ ] **Step 3: Type-check**

Run: `cd minion_hub && bun run check`
Expected: 0 errors, 0 warnings.

- [ ] **Step 4: Smoke-test scoring against gxv (live OpenRouter)**

Run the dev server or call the endpoint once authenticated; then:
`select count(*), round(avg(score)::numeric,2) from crm_message_sentiment;`
Expected: count > 0 after a batch (≤50), avg in [-1,1]. (If `OPENROUTER_API_KEY` is unset locally, `scored:0` is acceptable — verify no exception.)

- [ ] **Step 5: Commit**

```bash
cd minion_hub && git add src/server/services/crm-insights.service.ts src/routes/api/crm/insights/sentiment/+server.ts
git commit -m "feat(crm): sentiment scoring (OpenRouter batch) + monthly/current aggregates + API"
```

---

### Task 5: `CrmWordCloud.svelte` (d3-cloud)

**Files:**
- Create: `minion_hub/src/lib/components/crm/CrmWordCloud.svelte`
- Modify: `minion_hub/package.json` (add deps)

**Interfaces:**
- Consumes: `wordSize` (Task 2), `d3-cloud`.
- Produces: component `<CrmWordCloud words={{ word: string; count: number }[]} />`.

- [ ] **Step 1: Install deps**

Run: `cd minion_hub && bun add d3-cloud && bun add -d @types/d3-cloud`
Expected: `package.json` gains `d3-cloud` (dep) and `@types/d3-cloud` (devDep).

- [ ] **Step 2: Implement the component**

`minion_hub/src/lib/components/crm/CrmWordCloud.svelte`:

```svelte
<script lang="ts">
  import cloud from 'd3-cloud';
  import { wordSize } from './crm-insights';
  import * as m from '$lib/paraglide/messages';

  let { words }: { words: { word: string; count: number }[] } = $props();

  const W = 600;
  const H = 320;
  type Placed = { text: string; size: number; x: number; y: number; rotate: number };
  let placed = $state<Placed[]>([]);

  // Recompute the layout whenever the word list changes. d3-cloud measures text
  // on a canvas and finishes async (the 'end' callback), so we collect there and
  // let Svelte render the resulting positions reactively.
  $effect(() => {
    const list = words.slice(0, 60);
    if (list.length === 0) {
      placed = [];
      return;
    }
    const counts = list.map((w) => w.count);
    const min = Math.min(...counts);
    const max = Math.max(...counts);
    let cancelled = false;
    const layout = cloud<{ text: string; size: number }>()
      .size([W, H])
      .words(list.map((w) => ({ text: w.word, size: wordSize(w.count, min, max) })))
      .padding(3)
      .rotate(() => 0)
      .font('sans-serif')
      .fontSize((d) => d.size ?? 12)
      .on('end', (out) => {
        if (!cancelled) placed = out as Placed[];
      });
    layout.start();
    return () => {
      cancelled = true;
      layout.stop();
    };
  });

  // Accent-tinted by relative size for a calm, on-brand cloud.
  function fill(size: number): string {
    const t = Math.min(1, Math.max(0, (size - 12) / 36));
    return `color-mix(in srgb, var(--color-accent) ${Math.round(35 + t * 65)}%, var(--color-muted-foreground))`;
  }
</script>

{#if placed.length === 0}
  <p class="t-caption py-6 text-center">{m.crm_insights_no_words()}</p>
{:else}
  <svg viewBox={`0 0 ${W} ${H}`} class="w-full h-auto" role="img" aria-label={m.crm_insights_wordcloud()}>
    <g transform={`translate(${W / 2}, ${H / 2})`}>
      {#each placed as w (w.text)}
        <text
          text-anchor="middle"
          transform={`translate(${w.x}, ${w.y}) rotate(${w.rotate})`}
          font-size={`${w.size}px`}
          font-family="sans-serif"
          font-weight="600"
          fill={fill(w.size)}
        >{w.text}</text>
      {/each}
    </g>
  </svg>
{/if}
```

- [ ] **Step 3: Run the Svelte autofixer / check**

Run: `cd minion_hub && bun run check`
Expected: 0 errors, 0 warnings. (If a Svelte MCP autofixer is available, run it on this file and re-check.)

- [ ] **Step 4: Commit**

```bash
cd minion_hub && git add package.json bun.lock src/lib/components/crm/CrmWordCloud.svelte
git commit -m "feat(crm): CrmWordCloud (d3-cloud) component"
```

---

### Task 6: `CrmSentimentTrend.svelte` (d3-scale + d3-shape)

**Files:**
- Create: `minion_hub/src/lib/components/crm/CrmSentimentTrend.svelte`
- Modify: `minion_hub/package.json` (add deps)

**Interfaces:**
- Consumes: `d3-scale`, `d3-shape`.
- Produces: component `<CrmSentimentTrend points={{ month: string; avg: number; n: number }[]} current={{ avg: number; n: number } | null} />`.

- [ ] **Step 1: Install deps**

Run: `cd minion_hub && bun add d3-scale d3-shape && bun add -d @types/d3-scale @types/d3-shape`
Expected: `package.json` gains `d3-scale`, `d3-shape` (deps) + types (devDeps).

- [ ] **Step 2: Implement the component**

`minion_hub/src/lib/components/crm/CrmSentimentTrend.svelte`:

```svelte
<script lang="ts">
  import { scaleTime, scaleLinear } from 'd3-scale';
  import { line, curveMonotoneX } from 'd3-shape';
  import * as m from '$lib/paraglide/messages';

  let {
    points,
    current,
  }: {
    points: { month: string; avg: number; n: number }[];
    current: { avg: number; n: number } | null;
  } = $props();

  const W = 600;
  const H = 200;
  const PAD = { top: 16, right: 16, bottom: 24, left: 32 };

  // month 'YYYY-MM' → Date at the 1st (UTC).
  const data = $derived(
    points.map((p) => ({ date: new Date(`${p.month}-01T00:00:00Z`), avg: p.avg, n: p.n })),
  );

  const x = $derived(
    scaleTime()
      .domain(data.length ? [data[0].date, data[data.length - 1].date] : [new Date(), new Date()])
      .range([PAD.left, W - PAD.right]),
  );
  const y = $derived(scaleLinear().domain([-1, 1]).range([H - PAD.bottom, PAD.top]));
  const path = $derived(
    data.length
      ? line<{ date: Date; avg: number }>()
          .x((d) => x(d.date))
          .y((d) => y(d.avg))
          .curve(curveMonotoneX)(data) ?? ''
      : '',
  );
  const yTicks = $derived(y.ticks(5));
  const fmtScore = (v: number) => (v > 0 ? '+' : '') + v.toFixed(2);
</script>

<header class="trend-head">
  {#if current}
    <span class="trend-cur" style:color={current.avg >= 0 ? 'var(--color-success)' : 'var(--color-destructive)'}>
      {fmtScore(current.avg)}
    </span>
    <span class="t-caption">{m.crm_insights_sentiment_n({ count: current.n })}</span>
  {:else}
    <span class="t-caption">{m.crm_insights_sentiment_none()}</span>
  {/if}
</header>

{#if data.length > 0}
  <svg viewBox={`0 0 ${W} ${H}`} class="w-full h-auto" role="img" aria-label={m.crm_insights_sentiment_trend()}>
    <!-- zero baseline -->
    <line x1={PAD.left} x2={W - PAD.right} y1={y(0)} y2={y(0)} stroke="var(--hairline)" stroke-dasharray="3 3" />
    {#each yTicks as t (t)}
      <text x={PAD.left - 6} y={y(t)} text-anchor="end" dominant-baseline="middle" font-size="9" fill="var(--color-muted-foreground)">{fmtScore(t)}</text>
    {/each}
    <path d={path} fill="none" stroke="var(--color-accent)" stroke-width="2" />
    {#each data as d (d.date.toISOString())}
      <circle cx={x(d.date)} cy={y(d.avg)} r="3" fill="var(--color-accent)" />
    {/each}
  </svg>
{/if}
```

- [ ] **Step 3: Type-check**

Run: `cd minion_hub && bun run check`
Expected: 0 errors, 0 warnings.

- [ ] **Step 4: Commit**

```bash
cd minion_hub && git add package.json bun.lock src/lib/components/crm/CrmSentimentTrend.svelte
git commit -m "feat(crm): CrmSentimentTrend (d3-scale + d3-shape) line chart"
```

---

### Task 7: `/crm/insights` route + nav + i18n

**Files:**
- Create: `minion_hub/src/routes/(app)/crm/insights/+page.server.ts`
- Create: `minion_hub/src/routes/(app)/crm/insights/+page.svelte`
- Modify: `minion_hub/src/lib/components/crm/CrmNav.svelte`
- Modify: `minion_hub/messages/en.json`, `minion_hub/messages/es.json`

**Interfaces:**
- Consumes: `wordFrequency`, `sentimentByMonth`, `currentSentiment` (Tasks 3-4), `CrmWordCloud` (Task 5), `CrmSentimentTrend` (Task 6).

- [ ] **Step 1: Add i18n keys to `messages/en.json`**

Add (near other `crm_nav_*` / `crm_dash_*` keys):
```json
"crm_nav_insights": "Insights",
"crm_insights_title": "Insights",
"crm_insights_words_title": "Most-used client words",
"crm_insights_sentiment_title": "Customer sentiment",
"crm_insights_no_words": "No client words in this range yet.",
"crm_insights_wordcloud": "Word cloud of client messages",
"crm_insights_sentiment_trend": "Monthly customer-sentiment trend",
"crm_insights_sentiment_none": "No sentiment scored yet — it fills in as messages arrive.",
"crm_insights_sentiment_n": "based on {count} scored messages",
"crm_insights_analyze": "Analyze sentiment",
"crm_insights_analyzing": "Analyzing…",
"crm_insights_range_30d": "30d",
"crm_insights_range_90d": "90d",
"crm_insights_range_365d": "1y",
"crm_insights_range_all": "All time"
```

- [ ] **Step 2: Add the same keys to `messages/es.json`**

```json
"crm_nav_insights": "Análisis",
"crm_insights_title": "Análisis",
"crm_insights_words_title": "Palabras más usadas por clientes",
"crm_insights_sentiment_title": "Sentimiento del cliente",
"crm_insights_no_words": "Aún no hay palabras de clientes en este rango.",
"crm_insights_wordcloud": "Nube de palabras de los mensajes de clientes",
"crm_insights_sentiment_trend": "Tendencia mensual del sentimiento del cliente",
"crm_insights_sentiment_none": "Aún no hay sentimiento analizado — se completa conforme llegan mensajes.",
"crm_insights_sentiment_n": "según {count} mensajes analizados",
"crm_insights_analyze": "Analizar sentimiento",
"crm_insights_analyzing": "Analizando…",
"crm_insights_range_30d": "30d",
"crm_insights_range_90d": "90d",
"crm_insights_range_365d": "1a",
"crm_insights_range_all": "Todo"
```

- [ ] **Step 3: Compile i18n**

Run: `cd minion_hub && bun run i18n:compile`
Expected: "Successfully compiled".

- [ ] **Step 4: Add the Insights item to `CrmNav.svelte`**

In `minion_hub/src/lib/components/crm/CrmNav.svelte`, import `Sparkles` from `lucide-svelte` (add to the existing lucide import) and insert the item between `customers` and `settings`:

```ts
{ id: 'insights', label: m.crm_nav_insights(), icon: Sparkles, href: '/crm/insights' },
```

In `isActive`, the default `pathname.startsWith(href)` branch already covers `/crm/insights` (mirror however the existing items resolve — if the nav matches by `href`, no change needed; if it matches `id`, add `if (id === 'insights') return pathname.startsWith('/crm/insights');`). Verify `/crm` (dashboard) still only matches exactly so Insights doesn't co-highlight.

- [ ] **Step 5: Create `+page.server.ts`**

`minion_hub/src/routes/(app)/crm/insights/+page.server.ts`:

```ts
import type { PageServerLoad } from './$types';
import { error } from '@sveltejs/kit';
import { getCoreCtx } from '$server/auth/core-ctx';
import { wordFrequency, sentimentByMonth, currentSentiment } from '$server/services/crm-insights.service';

const DAY_MS = 24 * 60 * 60 * 1000;
const RANGE_DAYS: Record<string, number> = { '30d': 30, '90d': 90, '365d': 365 };

export const load: PageServerLoad = async ({ locals, url }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401, 'Authentication required');

  const range = url.searchParams.get('range') ?? '90d';
  const now = Date.now();
  const days = RANGE_DAYS[range];
  const fromIso = (range === 'all' || !days ? new Date(0) : new Date(now - days * DAY_MS)).toISOString();
  const toIso = new Date(now).toISOString();

  const [words, sentiment, current] = await Promise.all([
    wordFrequency(ctx, { fromIso, toIso, limit: 60 }),
    sentimentByMonth(ctx),
    currentSentiment(ctx),
  ]);

  return { words, sentiment, current, range: RANGE_DAYS[range] ? range : 'all' };
};
```

- [ ] **Step 6: Create `+page.svelte`**

`minion_hub/src/routes/(app)/crm/insights/+page.svelte`:

```svelte
<script lang="ts">
  import type { PageData } from './$types';
  import { goto, invalidateAll } from '$app/navigation';
  import { page } from '$app/state';
  import * as m from '$lib/paraglide/messages';
  import { Sparkles, RefreshCw } from 'lucide-svelte';
  import { PageHeader, Button } from '$lib/components/ui';
  import CrmWordCloud from '$lib/components/crm/CrmWordCloud.svelte';
  import CrmSentimentTrend from '$lib/components/crm/CrmSentimentTrend.svelte';

  let { data }: { data: PageData } = $props();

  const RANGES = [
    { id: '30d', label: () => m.crm_insights_range_30d() },
    { id: '90d', label: () => m.crm_insights_range_90d() },
    { id: '365d', label: () => m.crm_insights_range_365d() },
    { id: 'all', label: () => m.crm_insights_range_all() },
  ];
  function setRange(r: string) {
    const url = new URL(page.url);
    url.searchParams.set('range', r);
    goto(`${url.pathname}${url.search}`, { replaceState: true, keepFocus: true, noScroll: true });
  }

  let analyzing = $state(false);
  // Incremental scoring on first view (one capped batch), like the funnel auto-analyze.
  let tried = $state(false);
  $effect(() => {
    if (!tried) {
      tried = true;
      void analyze();
    }
  });
  async function analyze() {
    if (analyzing) return;
    analyzing = true;
    try {
      const res = await fetch('/api/crm/insights/sentiment', { method: 'POST' });
      if (res.ok) {
        const { scored } = await res.json();
        if (scored > 0) await invalidateAll();
      }
    } finally {
      analyzing = false;
    }
  }
</script>

<svelte:head><title>{m.crm_insights_title()} — {m.crm_title()}</title></svelte:head>

<div class="flex flex-col h-full min-h-0">
  <PageHeader title={m.crm_insights_title()} subtitle={m.crm_subtitle()}>
    {#snippet leading()}<Sparkles size={16} class="text-accent shrink-0" />{/snippet}
  </PageHeader>

  <div class="flex-1 min-h-0 overflow-auto p-4 flex flex-col gap-4 max-w-5xl">
    <!-- Word cloud -->
    <section class="card">
      <header class="card-h">
        <span>{m.crm_insights_words_title()}</span>
        <span class="seg" role="group">
          {#each RANGES as r (r.id)}
            <button class="seg-btn" class:active={data.range === r.id} onclick={() => setRange(r.id)}>{r.label()}</button>
          {/each}
        </span>
      </header>
      <CrmWordCloud words={data.words} />
    </section>

    <!-- Sentiment trend -->
    <section class="card">
      <header class="card-h">
        <span>{m.crm_insights_sentiment_title()}</span>
        <Button variant="outline" size="sm" onclick={analyze} disabled={analyzing}>
          <RefreshCw size={14} class={analyzing ? 'animate-spin' : ''} />
          {analyzing ? m.crm_insights_analyzing() : m.crm_insights_analyze()}
        </Button>
      </header>
      <CrmSentimentTrend points={data.sentiment} current={data.current} />
    </section>
  </div>
</div>

<style>
  .card { border: 1px solid var(--hairline); border-radius: var(--radius-lg); background: var(--color-card); padding: 0.85rem 1rem; }
  .card-h { display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; font-size: 0.78rem; font-weight: 600; color: var(--color-muted-foreground); text-transform: uppercase; letter-spacing: 0.03em; margin-bottom: 0.8rem; }
  .seg { display: inline-flex; gap: 0.15rem; padding: 0.2rem; border: 1px solid var(--hairline); border-radius: var(--radius-md); background: var(--color-card); }
  .seg-btn { padding: 0.2rem 0.55rem; border-radius: var(--radius-sm, 6px); font-size: 0.74rem; font-weight: 500; color: var(--color-muted-foreground); font-variant-numeric: tabular-nums; }
  .seg-btn:hover { color: var(--color-foreground); }
  .seg-btn.active { color: var(--color-accent); background: color-mix(in srgb, var(--color-accent) 14%, transparent); font-weight: 600; }
  :global(.trend-head) { display: flex; align-items: baseline; gap: 0.5rem; margin-bottom: 0.4rem; }
  :global(.trend-cur) { font-size: 1.4rem; font-weight: 700; font-variant-numeric: tabular-nums; }
</style>
```

(`PageHeader`, `Button` come from `$lib/components/ui`; `crm_subtitle`, `crm_title` already exist. The `.trend-head`/`.trend-cur` styles are `:global` because they render inside `CrmSentimentTrend`.)

- [ ] **Step 7: Type-check + run CRM tests**

Run: `cd minion_hub && bun run check && bun run vitest run src/lib/components/crm src/server/services`
Expected: check 0/0; all tests pass.

- [ ] **Step 8: Commit**

```bash
cd minion_hub && git add "src/routes/(app)/crm/insights" src/lib/components/crm/CrmNav.svelte messages/en.json messages/es.json
git commit -m "feat(crm): Insights tab — word cloud + sentiment trend (C1 + C2 groundwork)"
```

---

## Notes for the implementer

- After all tasks: `bun run check` 0/0, full `crm` + `services` suites green, and the migration applied to gxv.
- The word cloud and sentiment trend are intentionally sparse with today's 251-message corpus — that's expected; they grow as data accumulates.
- Do NOT build C3. Do NOT modify the gateway `messages` ledger schema.
- `bun.lock` (not `package-lock.json`) is the lockfile for this Bun project — include it in dep-install commits.
