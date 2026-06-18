# CRM C3 — Learn from Winning Conversations (dormant RAG groundwork) — Design

**Date:** 2026-06-18
**Project:** minion_hub (SvelteKit 2 / Svelte 5 / Bun, Postgres `gxv` with org-GUC RLS, pgvector)
**Origin:** CEO Renzo Granda — *"Que la IA aprenda de los chats exitosos (clientes compradores) para que pueda identificar en una nueva chat una similitud de conversación y pueda ayudarnos a cerrar en base a éxitos pasados."*

## Goal

Learn from **winning conversations** (contacts who bought a procedure) and, for an active
contact, surface the most **similar past winning conversations** — with what they bought — to
help the operator close, based on past successes.

## Data reality (why this is "dormant groundwork")

Validated on `gxv` 2026-06-18: of 41 buyer conversations, **avg 1.1 messages each, max 4, and
ZERO real dialogues** (≥2 inbound + ≥1 outbound). The ledger holds ~12 days of forward-flow
messages; buyers mostly transacted outside that window (WhatsApp history was never backfilled).

**Decision (user-approved):** build the full RAG pipeline now as **groundwork that improves as
conversations accumulate**. It will honestly show "limited data" / thin matches until real
multi-turn buyer dialogues exist. This mirrors the C2 sentiment-groundwork decision.

## Architecture

Embed each buyer's conversation into pgvector. For an active contact, embed their current
conversation and find nearest winning conversations by cosine similarity (mirrors the proven
`agent_memories` pgvector path: `embedding <=> toVectorLiteral(vec)::vector`, via `withOrgCore`).

Reuses existing infra: `embeddings.ts` (`embedText`, `embedTexts`, `embeddingsEnabled`,
`toVectorLiteral`, `EMBEDDING_DIMENSIONS = 1536`, `openai/text-embedding-3-small` via OpenRouter);
pgvector (installed); the finance bridge (identifies procedure buyers via WhatsApp phone match).

### Table `crm_win_embeddings` (core gxv, org-GUC RLS)

| col | type | notes |
|---|---|---|
| org_id | text | RLS GUC (matches messages.org_id / crm_/fin_ pattern) |
| contact_id | uuid | the buyer contact |
| embedding | vector(1536) | conversation embedding (text-embedding-3-small) |
| msg_count | int | messages in the embedded conversation (drives "thin" signal) |
| bought | text[] | distinct procedure names the contact purchased |
| snippet | text | first ~120 chars of the embedded conversation (so matches need no message re-load) |
| built_at | timestamptz | default now() |

PK `(org_id, contact_id)`. ivfflat cosine index `using ivfflat (embedding vector_cosine_ops)`
(exact scan is fine at this scale; index is for future growth). One hand-written migration at
meta-repo root, applied to gxv via psql (idempotent, `app_ledger` grant + force RLS + GUC policy).

### Service `crm-similarity.service.ts`

Guards: every function returns empty/null unless `bothEnabled(ctx,'crm','finances')` AND
`embeddingsEnabled()`.

```ts
buildWinIndex(ctx: CoreCtx): Promise<{ indexed: number }>
winIndexStatus(ctx: CoreCtx): Promise<{ count: number; builtAt: string | null; thin: boolean }>
similarWins(ctx: CoreCtx, contactId: string, k?: number): Promise<SimilarWin[]>
// SimilarWin = { contactId: string; displayName: string | null; similarity: number; bought: string[]; snippet: string }
```

- **buildWinIndex** — resolve procedure buyers (finance bridge: phone-match → invoices with a
  non-`%reserva%` line item). For each, load their conversation (`messages` joined on
  org+channel+chat_id via `crm_contact_identities`, chronological, inbound/outbound), format with
  `buildConversationText` (see helper), embed via `embedTexts` (batch, length-capped per doc),
  upsert `{embedding, msg_count, bought, built_at}` per contact. `bought` = distinct procedure
  names. Idempotent (re-embeds all; N is tiny). Skip contacts with no conversation text.
- **winIndexStatus** — `count`, latest `built_at`, and `thin = avg(msg_count) < 4` (honest
  "conversations are short — matches improve as chats accumulate" note in the UI).
- **similarWins** — build the target contact's current conversation text, `embedText`, then
  cosine-search `crm_win_embeddings` excluding the contact itself:
  `1 - (embedding <=> ${lit}::vector) as similarity ... order by embedding <=> ${lit}::vector limit k`.
  Join `crm_contacts` for `display_name`. `snippet` = first ~120 chars of the matched
  conversation text (recomputed cheaply, or store a short snippet column — see Open choice).
  Returns [] if the target has no conversation or the index is empty.

### Pure helper `crm-similarity.ts`

```ts
buildConversationText(rows: { direction: string; content: string | null }[], opts?: { maxChars?: number }): string
// "Cliente: …\nNosotros: …" chronological; skips empty; truncates to maxChars (default 4000).
isThin(avgMsgCount: number): boolean // avgMsgCount < 4
```

Unit-tested (no I/O).

### API

- `POST /api/crm/insights/win-index` → `buildWinIndex`, returns `winIndexStatus`. Auth required.
- `GET /api/crm/contacts/[id]/similar-wins` → `similarWins(ctx, id, 3)`, returns `{ wins }`.

### UI

- **Insights tab** (`/crm/insights`) — a "Learning from wins" card: status
  (`{count} winning conversations indexed · built {relative}`), a **Rebuild** button (POSTs the
  index endpoint, re-loads status), and a candid line when `thin` or `count === 0`. Hidden unless
  finance + embeddings are enabled.
- **Contact detail** (`/crm/[contactId]`) — a "Similar past wins" card with a **Find similar
  wins** button → on click GETs `similar-wins` and lists matches: contact name (link to
  `/crm/<id>`), `bought` procedure chips, similarity %, and the snippet. Honest empty state
  ("no similar wins yet — the learning index is still small"). Shown only when finance + embeddings
  are enabled.

## v1 scope (YAGNI)

Surface the similar winning conversations + their purchases only. **No LLM "suggested approach"
summary** in v1 — with one-line conversations it would hallucinate. Add it later once real
dialogues exist (a follow-up that reads the top matches and proposes a closing approach).

## Decoupling / error handling

- Finance-guarded (needs buyers) + embeddings-guarded (needs OPENROUTER/OPENAI key). Either off →
  functions return empty, UI cards hide. Purely additive; reverts cleanly.
- Embed/network failures → caught; `buildWinIndex` skips the failed batch and continues;
  `similarWins` returns []. Never blocks a page.

## Testing

- `crm-similarity.ts` pure helpers (`buildConversationText`, `isThin`) — vitest.
- Vector SQL mirrors the proven `agent_memories.searchMemories` path; `buildWinIndex` +
  `similarWins` validated against gxv (index builds over the ~41 buyer convos; a query returns
  ordered matches). `bun run check` 0/0; `crm` + `services` suites green.

## Open choice (decided)

Store a short **snippet** column on `crm_win_embeddings` (first ~120 chars of the embedded
conversation) so `similarWins` doesn't re-load message bodies for matched contacts. Add
`snippet text` to the table.

## Migration

1. `crm_win_embeddings` (vector(1536) + ivfflat index, RLS forced) — applied to gxv.
