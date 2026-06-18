# CRM C3 — Similar Winning Conversations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Embed buyer (procedure-purchaser) conversations into pgvector and surface, for an active contact, the most similar past winning conversations + what they bought — to help close.

**Architecture:** New `crm_win_embeddings` table (core gxv, mirrors `agent_memories` pgvector path). `crm-similarity.service.ts` builds the index (`embedTexts`) and queries it (`embedding <=> toVectorLiteral(vec)::vector` cosine). UI cards on the Insights tab (rebuild + status) and contact detail (find similar wins). Dormant until real multi-turn buyer dialogues accumulate.

**Tech Stack:** SvelteKit 2, Svelte 5 runes, Bun, Postgres gxv + pgvector + Drizzle, `embeddings.ts` (OpenRouter text-embedding-3-small, 1536-dim), finance bridge.

## Global Constraints

- TS strict, no `any`/`@ts-nocheck`; `bun run check` 0/0. Svelte 5 runes only.
- All core-DB access via `withOrgCore(ctx, tx => …)` (org-GUC RLS). Never `getCoreDb()` for tenant data.
- i18n keys to BOTH `messages/{en,es}.json`; run `bun run i18n:compile` after editing.
- Guards: every C3 service fn returns empty/null unless `bothEnabled(ctx,'crm','finances')` AND `embeddingsEnabled()`.
- Embeddings: import `embedText`, `embedTexts`, `embeddingsEnabled`, `toVectorLiteral`, `EMBEDDING_DIMENSIONS` (=1536) from `./embeddings`. Cosine: `1 - (embedding <=> ${lit}::vector)`; order by `embedding <=> ${lit}::vector`.
- Buyer = contact phone-matched (`right(regexp_replace(x,'\D','','g'),9)`) to a `fin_clients` row with a `fin_invoices`→`fin_invoice_items` line whose `description NOT ILIKE '%reserva%'`. Procedure names = those item descriptions.
- A contact's conversation = `messages` joined to its whatsapp `crm_contact_identities` (`m.org_id=ci.org_id AND m.channel=ci.channel AND m.chat_id=ci.external_id`), `is_bot is not true`, chronological by `coalesce(occurred_at,created_at)`. Text col is `content`; id is uuid; direction is `inbound|outbound`.
- Migration: hand-written idempotent SQL at meta root `supabase/migrations/<ts>_<name>.sql`, applied to gxv via psql. Timestamp after `20260617160000` (use `20260618120000`).
- C3 v1: NO LLM summary. Pure embedding similarity.

---

### Task 1: Schema + migration `crm_win_embeddings`

**Files:** Modify `src/server/db/pg-crm-schema.ts`; Create `supabase/migrations/20260618120000_crm_win_embeddings.sql` (meta root).

**Interfaces:** Produces table `crm_win_embeddings` (org_id text, contact_id uuid, embedding vector(1536), msg_count int, bought text[], snippet text, built_at timestamptz), PK (org_id, contact_id).

- [ ] **Step 1: Drizzle table.** pgvector has no first-class drizzle type here; declare embedding via `customType` OR omit it from the drizzle table and manage via raw SQL. Mirror `agent_memories`: check how `pg-*.ts` declares its vector column. If `agent_memories` is NOT in `pg-crm-schema.ts`, declare `crmWinEmbeddings` WITHOUT the embedding column in drizzle (the service uses raw `sql` for vector ops anyway), keeping columns: orgId, contactId, msgCount, bought (`text('bought').array()`), snippet, builtAt. Add to `pg-crm-schema.ts`:

```ts
export const crmWinEmbeddings = pgTable(
  'crm_win_embeddings',
  {
    orgId: text('org_id').notNull(),
    contactId: uuid('contact_id').notNull(),
    // embedding vector(1536) is managed via raw SQL (pgvector); not modeled here.
    msgCount: integer('msg_count').notNull(),
    bought: text('bought').array().notNull().default([]),
    snippet: text('snippet'),
    builtAt: timestamp('built_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.orgId, t.contactId] })],
);
```
Add `integer` to the drizzle import list if absent.

- [ ] **Step 2: Migration SQL.** Create `supabase/migrations/20260618120000_crm_win_embeddings.sql`:

```sql
-- CRM C3 — winning-conversation embeddings (dormant RAG groundwork). One row per
-- buyer conversation. pgvector cosine search mirrors agent_memories. Idempotent.
create extension if not exists vector;
--> statement-breakpoint
create table if not exists public.crm_win_embeddings (
  org_id     text not null,
  contact_id uuid not null,
  embedding  vector(1536),
  msg_count  integer not null default 0,
  bought     text[] not null default '{}',
  snippet    text,
  built_at   timestamptz not null default now(),
  primary key (org_id, contact_id)
);
--> statement-breakpoint
create index if not exists crm_win_embeddings_vec_idx
  on public.crm_win_embeddings using ivfflat (embedding vector_cosine_ops) with (lists = 10);
--> statement-breakpoint
grant select, insert, update, delete on public.crm_win_embeddings to app_ledger;
--> statement-breakpoint
alter table public.crm_win_embeddings enable row level security;
--> statement-breakpoint
alter table public.crm_win_embeddings force  row level security;
--> statement-breakpoint
create policy crm_win_embeddings_org_guc on public.crm_win_embeddings
  for all using (org_id = current_setting('app.current_org_id', true))
          with check (org_id = current_setting('app.current_org_id', true));
```

- [ ] **Step 3: Apply to gxv** via psql (`$SUPABASE_DB_URL`), verify `select count(*) from public.crm_win_embeddings;` → 0.
- [ ] **Step 4:** `bun run check` → 0/0.
- [ ] **Step 5: Commit** (schema in hub, migration in meta — two commits).

---

### Task 2: Pure helper `crm-similarity.ts` + tests

**Files:** Create `src/lib/components/crm/crm-similarity.ts` + `crm-similarity.test.ts`.

**Interfaces:** `buildConversationText(rows: { direction: string; content: string | null }[], opts?: { maxChars?: number }): string`; `isThin(avgMsgCount: number): boolean`.

- [ ] **Step 1: Test (write first, run, expect fail):**

```ts
import { describe, it, expect } from 'vitest';
import { buildConversationText, isThin } from './crm-similarity';

describe('buildConversationText', () => {
  it('labels by direction, chronological, skips empties', () => {
    const t = buildConversationText([
      { direction: 'inbound', content: 'hola, cuanto cuesta?' },
      { direction: 'outbound', content: 'S/ 500' },
      { direction: 'inbound', content: '  ' },
    ]);
    expect(t).toBe('Cliente: hola, cuanto cuesta?\nNosotros: S/ 500');
  });
  it('truncates to maxChars', () => {
    const t = buildConversationText([{ direction: 'inbound', content: 'x'.repeat(50) }], { maxChars: 20 });
    expect(t.length).toBe(20);
  });
});

describe('isThin', () => {
  it('flags short average conversations', () => {
    expect(isThin(1.1)).toBe(true);
    expect(isThin(4)).toBe(false);
  });
});
```

- [ ] **Step 2: Implement:**

```ts
/** Pure helpers for C3 similar-wins. No I/O. */
export function buildConversationText(
  rows: { direction: string; content: string | null }[],
  opts?: { maxChars?: number },
): string {
  const max = opts?.maxChars ?? 4000;
  const text = rows
    .map((r) => {
      const body = (r.content ?? '').trim();
      if (!body) return null;
      const who = r.direction === 'inbound' ? 'Cliente' : 'Nosotros';
      return `${who}: ${body}`;
    })
    .filter((l): l is string => l !== null)
    .join('\n');
  return text.length > max ? text.slice(0, max) : text;
}

/** Conversations averaging < 4 messages are too thin for meaningful similarity. */
export function isThin(avgMsgCount: number): boolean {
  return avgMsgCount < 4;
}
```

- [ ] **Step 3:** run test → pass. **Step 4:** Commit.

---

### Task 3: `crm-similarity.service.ts` (buildWinIndex, winIndexStatus, similarWins)

**Files:** Create `src/server/services/crm-similarity.service.ts`.

**Interfaces:** `buildWinIndex(ctx): Promise<{indexed:number}>`; `winIndexStatus(ctx): Promise<{count:number;builtAt:string|null;thin:boolean}>`; `similarWins(ctx, contactId, k?): Promise<SimilarWin[]>` where `SimilarWin = {contactId:string;displayName:string|null;similarity:number;bought:string[];snippet:string}`.

- [ ] **Step 1: Implement** (mirrors `agent-memories.service.ts` vector usage + `crm-finance.service.ts` phone bridge):

```ts
import { sql } from 'drizzle-orm';
import { withOrgCore } from '$server/db/with-org-core';
import type { CoreCtx } from '$server/auth/core-ctx';
import { bothEnabled } from './modules.service';
import { embedText, embedTexts, embeddingsEnabled, toVectorLiteral } from './embeddings';
import { buildConversationText, isThin } from '$lib/components/crm/crm-similarity';

const PHONE9 = (col: string) => sql.raw(`right(regexp_replace(coalesce(${col},''),'\\D','','g'), 9)`);
const IS_PROCEDURE = sql.raw(`(ii.description is not null and ii.description not ilike '%reserva%')`);

async function enabled(ctx: CoreCtx): Promise<boolean> {
  return embeddingsEnabled() && (await bothEnabled(ctx, 'crm', 'finances'));
}

export interface SimilarWin { contactId: string; displayName: string | null; similarity: number; bought: string[]; snippet: string }

/** Load a contact's conversation text (chronological, inbound/outbound). */
async function conversationText(ctx: CoreCtx, contactId: string): Promise<{ text: string; count: number }> {
  return withOrgCore(ctx, async (tx) => {
    const rows = (await tx.execute(sql`
      select m.direction, m.content
      from crm_contact_identities ci
      join messages m on m.org_id = ci.org_id and m.channel = ci.channel and m.chat_id = ci.external_id
      where ci.org_id = current_setting('app.current_org_id', true) and ci.contact_id = ${contactId}
        and m.is_bot is not true
      order by coalesce(m.occurred_at, m.created_at) asc
    `)) as unknown as Array<{ direction: string; content: string | null }>;
    return { text: buildConversationText(rows), count: rows.length };
  });
}

export async function buildWinIndex(ctx: CoreCtx): Promise<{ indexed: number }> {
  if (!(await enabled(ctx))) return { indexed: 0 };
  // buyers (procedure purchasers) + their bought procedures + whatsapp external_id
  const buyers = await withOrgCore(ctx, async (tx) => {
    return (await tx.execute(sql`
      with phones as (
        select ci.contact_id, ci.external_id, ${PHONE9('ci.external_id')} p9
        from crm_contact_identities ci
        where ci.org_id = current_setting('app.current_org_id', true) and ci.channel = 'whatsapp'
          and length(${PHONE9('ci.external_id')}) >= 8
      )
      select ph.contact_id::text id, ph.external_id,
             array_agg(distinct ii.description) filter (where ${IS_PROCEDURE}) bought
      from phones ph
      join fin_clients fc on fc.org_id = current_setting('app.current_org_id', true) and ${PHONE9('fc.phone')} = ph.p9
      join fin_invoices fi on fi.client_id = fc.id
      join fin_invoice_items ii on ii.invoice_id = fi.id
      group by ph.contact_id, ph.external_id
      having bool_or(${IS_PROCEDURE})
    `)) as unknown as Array<{ id: string; external_id: string; bought: string[] | null }>;
  });
  if (buyers.length === 0) return { indexed: 0 };

  // Build each conversation's text, embed in one batch, upsert.
  const docs: { id: string; text: string; count: number; bought: string[] }[] = [];
  for (const b of buyers) {
    const conv = await conversationText(ctx, b.id);
    if (!conv.text) continue;
    docs.push({ id: b.id, text: conv.text, count: conv.count, bought: (b.bought ?? []).filter(Boolean) });
  }
  if (docs.length === 0) return { indexed: 0 };

  let vectors: number[][];
  try {
    vectors = await embedTexts(docs.map((d) => d.text));
  } catch {
    return { indexed: 0 };
  }

  await withOrgCore(ctx, async (tx) => {
    for (let i = 0; i < docs.length; i++) {
      const d = docs[i];
      const lit = toVectorLiteral(vectors[i]);
      const snippet = d.text.slice(0, 120);
      await tx.execute(sql`
        insert into crm_win_embeddings (org_id, contact_id, embedding, msg_count, bought, snippet, built_at)
        values (current_setting('app.current_org_id', true), ${d.id}::uuid, ${lit}::vector, ${d.count}, ${d.bought}, ${snippet}, now())
        on conflict (org_id, contact_id) do update set
          embedding = excluded.embedding, msg_count = excluded.msg_count,
          bought = excluded.bought, snippet = excluded.snippet, built_at = excluded.built_at
      `);
    }
  });
  return { indexed: docs.length };
}

export async function winIndexStatus(ctx: CoreCtx): Promise<{ count: number; builtAt: string | null; thin: boolean }> {
  if (!(await enabled(ctx))) return { count: 0, builtAt: null, thin: false };
  return withOrgCore(ctx, async (tx) => {
    const [r] = (await tx.execute(sql`
      select count(*)::int n, max(built_at) built, coalesce(avg(msg_count),0)::float8 avg_msgs
      from crm_win_embeddings where org_id = current_setting('app.current_org_id', true)
    `)) as unknown as Array<{ n: number; built: string | null; avg_msgs: number }>;
    const count = Number(r?.n ?? 0);
    return { count, builtAt: r?.built != null ? String(r.built) : null, thin: count > 0 && isThin(Number(r?.avg_msgs ?? 0)) };
  });
}

export async function similarWins(ctx: CoreCtx, contactId: string, k = 3): Promise<SimilarWin[]> {
  if (!(await enabled(ctx))) return [];
  const conv = await conversationText(ctx, contactId);
  if (!conv.text) return [];
  let vec: number[];
  try {
    vec = await embedText(conv.text);
  } catch {
    return [];
  }
  const lit = toVectorLiteral(vec);
  return withOrgCore(ctx, async (tx) => {
    const rows = (await tx.execute(sql`
      select w.contact_id::text id, c.display_name, w.bought, coalesce(w.snippet,'') snippet,
             (1 - (w.embedding <=> ${lit}::vector))::float8 similarity
      from crm_win_embeddings w
      join crm_contacts c on c.id = w.contact_id
      where w.org_id = current_setting('app.current_org_id', true)
        and w.contact_id <> ${contactId} and w.embedding is not null
      order by w.embedding <=> ${lit}::vector
      limit ${sql.raw(String(Math.min(10, Math.max(1, k))))}
    `)) as unknown as Array<{ id: string; display_name: string | null; bought: string[] | null; snippet: string; similarity: number }>;
    return rows.map((r) => ({
      contactId: String(r.id), displayName: r.display_name != null ? String(r.display_name) : null,
      similarity: Number(r.similarity), bought: (r.bought ?? []).filter(Boolean), snippet: String(r.snippet),
    }));
  });
}
```

- [ ] **Step 2: Validate on gxv** — call `buildWinIndex` then `select count(*), round(avg(msg_count),1) from crm_win_embeddings;` (expect ~41 rows). Run a `similarWins` for a buyer contact id and confirm ordered rows return. (Use a throwaway script or the API once Task 4 is done.)
- [ ] **Step 3:** `bun run check` 0/0. **Step 4:** Commit.

---

### Task 4: API routes

**Files:** Create `src/routes/api/crm/insights/win-index/+server.ts` and `src/routes/api/crm/contacts/[id]/similar-wins/+server.ts`.

- [ ] **Step 1: win-index (POST):**
```ts
import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { getCoreCtx } from '$server/auth/core-ctx';
import { buildWinIndex, winIndexStatus } from '$server/services/crm-similarity.service';
export const POST: RequestHandler = async ({ locals }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401, 'Authentication required');
  await buildWinIndex(ctx);
  return json(await winIndexStatus(ctx));
};
```
- [ ] **Step 2: similar-wins (GET):**
```ts
import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { getCoreCtx } from '$server/auth/core-ctx';
import { similarWins } from '$server/services/crm-similarity.service';
export const GET: RequestHandler = async ({ locals, params }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401, 'Authentication required');
  const wins = await similarWins(ctx, params.id!, 3);
  return json({ wins });
};
```
- [ ] **Step 3:** check 0/0. **Step 4:** Commit.

---

### Task 5: UI — Insights "Learning from wins" card + contact-detail "Similar past wins" card + i18n

**Files:** Modify `src/routes/(app)/crm/insights/+page.{server,svelte}`, `src/routes/(app)/crm/[contactId]/+page.{server,svelte}`, `messages/{en,es}.json`. Create `src/lib/components/crm/CrmSimilarWins.svelte`.

- [ ] **Step 1: i18n keys (en):** `crm_wins_title`="Learning from wins", `crm_wins_status`="{count} winning conversations indexed", `crm_wins_never`="No winning conversations indexed yet.", `crm_wins_thin`="Conversations are short — matches improve as chats accumulate.", `crm_wins_rebuild`="Rebuild", `crm_wins_rebuilding`="Rebuilding…", `crm_similar_title`="Similar past wins", `crm_similar_find`="Find similar wins", `crm_similar_finding`="Searching…", `crm_similar_none`="No similar wins yet — the learning index is still small.", `crm_similar_match`="{pct}% match", `crm_similar_disabled`="Enable Finances to learn from past purchases." Spanish equivalents in es.json. Run `bun run i18n:compile`.

- [ ] **Step 2: Insights server** — add `winIndexStatus` to the load:
```ts
import { winIndexStatus } from '$server/services/crm-similarity.service';
// in load: const winIndex = await winIndexStatus(ctx); return { …, winIndex };
```

- [ ] **Step 3: Insights svelte** — add a card after the sentiment card:
```svelte
<section class="card">
  <header class="card-h">
    <span>{m.crm_wins_title()}</span>
    <Button variant="outline" size="sm" onclick={rebuildWins} disabled={rebuilding}>
      <RefreshCw size={14} class={rebuilding ? 'animate-spin' : ''} />
      {rebuilding ? m.crm_wins_rebuilding() : m.crm_wins_rebuild()}
    </Button>
  </header>
  {#if data.winIndex.count > 0}
    <p class="t-body">{m.crm_wins_status({ count: data.winIndex.count })}</p>
    {#if data.winIndex.thin}<p class="t-caption">{m.crm_wins_thin()}</p>{/if}
  {:else}
    <p class="t-caption">{m.crm_wins_never()}</p>
  {/if}
</section>
```
with `let rebuilding = $state(false); async function rebuildWins(){ rebuilding=true; try { const r=await fetch('/api/crm/insights/win-index',{method:'POST'}); if(r.ok) await invalidateAll(); } finally { rebuilding=false; } }` (import `invalidateAll`).

- [ ] **Step 4: `CrmSimilarWins.svelte`** (contact-detail card; lazy fetch on button):
```svelte
<script lang="ts">
  import * as m from '$lib/paraglide/messages';
  import { Button } from '$lib/components/ui';
  import { Trophy, Search } from 'lucide-svelte';
  type Win = { contactId: string; displayName: string | null; similarity: number; bought: string[]; snippet: string };
  let { contactId }: { contactId: string } = $props();
  let loading = $state(false);
  let wins = $state<Win[] | null>(null);
  async function find() {
    loading = true;
    try {
      const r = await fetch(`/api/crm/contacts/${contactId}/similar-wins`);
      if (r.ok) wins = (await r.json()).wins as Win[];
    } finally { loading = false; }
  }
</script>
<section class="card">
  <header class="card-h"><span class="flex items-center gap-1.5"><Trophy size={13} /> {m.crm_similar_title()}</span></header>
  {#if wins === null}
    <Button variant="outline" size="sm" onclick={find} disabled={loading}>
      <Search size={14} /> {loading ? m.crm_similar_finding() : m.crm_similar_find()}
    </Button>
  {:else if wins.length === 0}
    <p class="t-caption">{m.crm_similar_none()}</p>
  {:else}
    <ul class="wins">
      {#each wins as w (w.contactId)}
        <li class="win">
          <a class="win-name" href={`/crm/${w.contactId}`}>{w.displayName ?? w.contactId}</a>
          <span class="win-pct">{m.crm_similar_match({ pct: Math.round(w.similarity * 100) })}</span>
          {#if w.bought.length}<div class="win-bought">{#each w.bought.slice(0,4) as b (b)}<span class="chip">{b}</span>{/each}</div>{/if}
          {#if w.snippet}<p class="win-snip t-caption">{w.snippet}</p>{/if}
        </li>
      {/each}
    </ul>
  {/if}
</section>
<style>
  .card { border:1px solid var(--hairline); border-radius:var(--radius-lg); background:var(--color-card); padding:0.85rem 1rem; }
  .card-h { display:flex; align-items:center; justify-content:space-between; font-size:0.78rem; font-weight:600; color:var(--color-muted-foreground); text-transform:uppercase; letter-spacing:0.03em; margin-bottom:0.6rem; }
  .wins { display:flex; flex-direction:column; gap:0.6rem; }
  .win { display:flex; flex-direction:column; gap:0.2rem; padding-bottom:0.5rem; border-bottom:1px solid var(--hairline); }
  .win:last-child { border-bottom:none; }
  .win-name { font-weight:600; color:var(--color-accent); }
  .win-pct { font-size:0.72rem; color:var(--color-muted-foreground); font-variant-numeric:tabular-nums; }
  .win-bought { display:flex; flex-wrap:wrap; gap:0.25rem; }
  .chip { font-size:0.66rem; padding:0.05rem 0.4rem; border-radius:999px; background:color-mix(in srgb, var(--color-accent) 12%, transparent); color:var(--color-accent); }
  .win-snip { overflow:hidden; text-overflow:ellipsis; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; }
</style>
```

- [ ] **Step 5: Mount on contact detail.** In `src/routes/(app)/crm/[contactId]/+page.svelte`, import `CrmSimilarWins` and render it in the left column (below the Financials card) ONLY when `data.finance` is present (proxy for finance enabled):
```svelte
{#if data.finance}<CrmSimilarWins contactId={c.id} />{/if}
```
(Reuse `c.id`. The card self-handles the empty/disabled cases via the API guards.)

- [ ] **Step 6:** `bun run i18n:compile && bun run check` 0/0; `bun run vitest run src/lib/components/crm src/server/services` green. **Step 7:** Commit.

---

## Notes for the implementer
- After all tasks: check 0/0, suites green, migration live on gxv, `buildWinIndex` validated (≈41 rows).
- The feature is intentionally dormant (thin matches) until real multi-turn buyer conversations exist.
- Do NOT add an LLM summary in v1. `bun.lock` is the lockfile (no new deps expected — embeddings infra already present).
