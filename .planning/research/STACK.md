# Stack Research

**Domain:** SvelteKit dashboard — skill builder hardening (validation, cost tracking, versioning, DAG edge UX)
**Researched:** 2026-03-18
**Confidence:** HIGH (all findings verified against official docs or installed package versions)

---

## What This Research Covers

This is a SUBSEQUENT MILESTONE for an existing SvelteKit 2 + Svelte 5 dashboard. The core stack (SvelteKit, Drizzle ORM, LibSQL/Turso, @xyflow/svelte, Anthropic/OpenRouter API) is already in place. This file covers only the ADDITIONS and DECISIONS needed for the v2.0 skill builder improvements:

- Shared validation: zod/valibot vs pure TypeScript
- OpenRouter usage token tracking (cost display)
- AbortController timeout pattern for AI routes
- @xyflow/svelte custom edge types (data flow visualization, edge labels)
- Drizzle schema additions for versioning tables
- DB migration approach for new tables

---

## Current Installed Versions (Already in package.json)

| Package | Installed Version | Role |
|---------|-------------------|------|
| `@sveltejs/kit` | 2.53.3 | Framework |
| `svelte` | 5.53.5 | UI runtime (runes) |
| `@xyflow/svelte` | 1.5.1 | DAG canvas |
| `drizzle-orm` | 0.45.1 | ORM |
| `drizzle-kit` | 0.31.9 | Migrations |
| `@libsql/client` | 0.17.0 | DB client (Turso/SQLite) |
| `@paralleldrive/cuid2` | 3.3.0 | ID generation |

---

## Recommended Stack

### Core Technologies (No Changes Required)

The existing stack handles all milestone goals. No framework or ORM changes needed.

### New Additions

| Library | Version | Purpose | Why |
|---------|---------|---------|-----|
| None required | — | Validation | Pure TypeScript is sufficient (see decision below) |
| None required | — | Cost tracking | OpenRouter `usage` object already in response; parse + store in new DB column |
| None required | — | AbortController | Web-standard API available in Node 22+ / Bun — no library needed |
| None required | — | Versioning | New Drizzle table — no new library needed |

**Net new npm installs: zero.** All milestone features are achievable with existing dependencies.

---

## Decision 1: Validation — Pure TypeScript, Not Zod/Valibot

**Decision: Skip both. Stay with pure TypeScript.**

**Rationale:**

The builder's validation logic is server-side only (see `validateSkillForPublish` in `builder.service.ts`). It already exists as plain TypeScript that returns `{ valid: boolean; errors: string[] }`. The new requirement is "shared validation" — meaning the same rules run on both client (disable publish button) and server (block the publish endpoint).

For this use case:

- Validation rules are simple structural checks (name truthy, chapters > 0, each chapter has guide text, edges are connected). No complex type coercion or nested schema parsing.
- The existing `ValidationResult` interface is the right abstraction. Extract it to `$lib/utils/builder-validation.ts` and import from both the page component and the server route.
- Adding Zod adds ~17.7 kB to the client bundle for zero benefit. The existing validation does not use JSON schema coercion anywhere.
- Valibot (1.4 kB) would be acceptable on bundle-size grounds alone, but the added dependency and learning curve still cost more than the value delivered for checks this simple.

**When you would add zod/valibot:** If API request bodies needed runtime coercion + type narrowing (e.g., parsing complex nested user input from untrusted sources), Zod's inference is the right trade-off. This codebase uses Drizzle for DB I/O (typed) and the AI endpoints validate a single body field (`description.trim()`). Not the threshold.

**Action:** Extract the existing validation function to a shared `$lib/utils/builder-validation.ts` module. No new package.

---

## Decision 2: Cost Tracking — OpenRouter Usage Object

**Pattern: Parse `usage` from OpenRouter response, store in DB column, display in UI.**

OpenRouter's API response contains a standard `usage` object:

```typescript
// Already returned in completion.choices[0] parent object
interface OpenRouterUsage {
  prompt_tokens: number;       // input tokens
  completion_tokens: number;   // output tokens
  total_tokens: number;
  cost?: number;               // credit cost in USD (optional, provided by OpenRouter)
  prompt_tokens_details?: {
    cached_tokens?: number;
  };
}
```

Cost is already computed by OpenRouter and returned in `usage.cost`. No local calculation required.

**Schema addition for cost tracking:**

Add two integer columns to `built_skills` (migration: add columns with defaults):

```sql
-- New columns on built_skills
prompt_tokens_total    INTEGER NOT NULL DEFAULT 0
completion_tokens_total INTEGER NOT NULL DEFAULT 0
ai_cost_usd_millicents INTEGER NOT NULL DEFAULT 0  -- store as integer, divide by 100000 for display
```

Alternatively: a separate `skill_ai_generations` table if per-generation history is needed (see versioning section). For the milestone goal of "cost display", accumulating totals on the skill row is sufficient.

**Display:** Format as `$0.0042` by dividing `ai_cost_usd_millicents / 100000`. No formatting library needed — `Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 4 })` is built into browsers.

**Confidence:** HIGH — verified against OpenRouter API docs and current Anthropic pricing page.

---

## Decision 3: AbortController Timeout — Web Standard API

**Pattern: `AbortSignal.timeout(ms)` passed directly to `fetch`.**

```typescript
// In suggest-skill/+server.ts and suggest-chapter/+server.ts
const res = await fetch(OPENROUTER_URL, {
  method: 'POST',
  signal: AbortSignal.timeout(30_000),  // 30 second hard timeout
  headers: { ... },
  body: JSON.stringify({ ... }),
});
```

**No library needed.** `AbortSignal.timeout()` is a Web API available in Node 22 and Bun. A SvelteKit bug where `AbortSignal.timeout()` did not respect timeout values for internal SvelteKit routes was fixed in PR #13877 (merged June 2025, landed in SvelteKit 2.21.1). The installed version is 2.53.3, so this is resolved.

For the AI endpoints (calling external OpenRouter), the fix is not needed — they call an external URL, which always respected the timeout. The pattern works today.

**Catch the abort error explicitly:**

```typescript
try {
  const res = await fetch(OPENROUTER_URL, { signal: AbortSignal.timeout(30_000), ... });
  // ...
} catch (e) {
  if (e instanceof DOMException && e.name === 'TimeoutError') {
    return json({ error: 'AI request timed out (30s)' }, { status: 504 });
  }
  // other errors...
}
```

**Confidence:** HIGH — verified via SvelteKit issue #13874 (closed June 2025) and PR #13877.

---

## Decision 4: @xyflow/svelte Custom Edges — Built-In API, No New Package

**Installed: `@xyflow/svelte@1.5.1`. No upgrade needed.**

For data flow visualization (upstream output preview on edge hover, edge labels showing data shape), use the `edgeTypes` API which is already available:

### Custom Edge Component Pattern

```svelte
<!-- DataFlowEdge.svelte -->
<script lang="ts">
  import { BaseEdge, EdgeLabel, getBezierPath, type EdgeProps } from '@xyflow/svelte';

  let {
    id, sourceX, sourceY, targetX, targetY,
    sourcePosition, targetPosition,
    data,          // your custom data object
    label,
    markerEnd,
  }: EdgeProps = $props();

  const [edgePath, labelX, labelY] = $derived(
    getBezierPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition })
  );
</script>

<BaseEdge path={edgePath} {markerEnd} />

{#if data?.outputPreview}
  <EdgeLabel x={labelX} y={labelY}>
    <div class="edge-preview nodrag nopan">{data.outputPreview}</div>
  </EdgeLabel>
{/if}
```

Register in ChapterDAG.svelte:

```typescript
import { type EdgeTypes } from '@xyflow/svelte';
import DataFlowEdge from './DataFlowEdge.svelte';

// Define OUTSIDE component to prevent re-renders
const edgeTypes: EdgeTypes = {
  'data-flow': DataFlowEdge,
} as unknown as EdgeTypes;
```

**Key points:**
- `EdgeLabel` is the correct component for interactive labels (replaces `EdgeLabelRenderer` which is React Flow terminology). Use `nodrag nopan` CSS classes on interactive elements inside labels.
- `BaseEdge` handles the invisible click-target width automatically.
- Edge `data` field carries the custom payload (outputDef text, upstream chapter name, etc.).
- The existing `as unknown as EdgeTypes` cast is required and correct — the Svelte types don't fully align.

**Confidence:** HIGH — verified against svelteflow.dev API reference and existing ChapterDAG.svelte patterns.

---

## Decision 5: Skill Versioning — New Drizzle Table, db:push

**Pattern: Append-only snapshot table. Each "publish" writes an immutable version row.**

```typescript
// Addition to src/server/db/schema/builder.ts

export const builtSkillVersions = sqliteTable('built_skill_versions', {
  id: text('id').primaryKey(),
  skillId: text('skill_id').notNull().references(() => builtSkills.id, { onDelete: 'cascade' }),
  version: integer('version').notNull(),         // monotonically increasing per skill
  snapshot: text('snapshot').notNull(),          // JSON: full skill + chapters + edges at publish time
  changelog: text('changelog').default(''),      // author-provided description of changes
  publishedAt: integer('published_at').notNull(),
  publishedBy: text('published_by'),
});
```

**Why JSON snapshot (not normalized tables):**
- Versions are read-only after creation — no need for relational queries into version data
- Snapshot capture is a single `JSON.stringify({ skill, chapters, edges })` call
- Reconstructing a specific version is a single `JSON.parse()` — no JOIN queries needed
- Fits the immutable audit-log pattern: append-only, never updated

**Why NOT normalize versions into separate `builtChapters_versions` tables:**
- Creates 3-4 additional tables for limited query benefit
- Publishing creates one atomic record, not a cascade of inserts
- For a builder where versions are viewed/compared rarely, the simpler model wins

**Migration approach:** Use `bun run db:push` for local dev, `db:generate` + `db:migrate` for production Turso (as per the existing project convention in `package.json`). Adding a new table is safe with both approaches — no ALTER TABLE complications. LibSQL/Turso supports ADD COLUMN for incremental additions.

**Version numbering:** Query `MAX(version)` for the skill before inserting, increment by 1. Alternatively use `COUNT(*)`. Either works for single-writer access patterns.

**Confidence:** HIGH — Drizzle + LibSQL docs verified, pattern is standard.

---

## Supporting Libraries (Already Installed)

| Library | Version | Relevant to This Milestone |
|---------|---------|---------------------------|
| `@paralleldrive/cuid2` | 3.3.0 | ID generation for new version rows — already used |
| `lucide-svelte` | 0.575.0 | Icons for validation error panel, cost display — already used |
| `drizzle-orm` | 0.45.1 | New versioning table queries — already used |

---

## Alternatives Considered

| Category | Recommended | Alternative | Why Not |
|----------|-------------|-------------|---------|
| Validation | Pure TypeScript | Zod | 17.7 kB client bundle for checks that are 10 lines of TS. Not worth it. |
| Validation | Pure TypeScript | Valibot | 1.4 kB and more appropriate, but still adds a dep + mental model for zero concrete gain on this codebase's validation complexity. |
| Cost tracking | Parse usage.cost from response | Local token × rate calculation | OpenRouter already returns `cost` in usage. Local calculation introduces model-rate maintenance burden. |
| Versioning storage | JSON snapshot column | Normalized version tables | Snapshot is simpler, atomic, and sufficient for infrequent read access. |
| Versioning storage | JSON snapshot column | Event sourcing / diff-only | Overkill for this use case — full snapshots are small (<50 KB) and simpler to reconstruct. |
| Timeout | AbortSignal.timeout() | Promise.race() with setTimeout | AbortSignal.timeout() is the modern standard, more composable, correctly cleans up timers. |

---

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| `zod` or `valibot` for this milestone | Server-only structural validation doesn't benefit from schema parsing; client bundle cost (zod) or unnecessary dep (valibot) | Pure TypeScript `ValidationResult` shared module |
| Separate AI SDK (`@ai-sdk/anthropic` or `ai`) | The codebase uses OpenRouter via raw `fetch` with tool_calling. The AI SDK adds abstraction over a pattern that already works correctly with typed schemas. | Continue using raw `fetch` + typed tool schemas |
| `EventSource` / SSE for streaming | Current AI endpoints return complete JSON — no streaming UX is planned for v2.0 | Current `fetch` + `json()` pattern is correct |
| `drizzle-kit push` on production Turso for versioning table | Push bypasses migration files; losing migration history is a production risk | `drizzle-kit generate` + `drizzle-kit migrate` for Turso production |

---

## Installation

**No new packages required for this milestone.**

All features are built from:
1. Existing `@xyflow/svelte@1.5.1` (`BaseEdge`, `EdgeLabel`, `EdgeTypes`, `getBezierPath`)
2. Existing `drizzle-orm@0.45.1` (new schema table + queries)
3. Web-standard `AbortSignal.timeout()` (Node 22 / Bun built-in)
4. Extracted TypeScript validation module (no dependency)

---

## Version Compatibility Notes

| Package | Version | Compatibility Note |
|---------|---------|-------------------|
| `@xyflow/svelte` | 1.5.1 | `EdgeTypes` cast `as unknown as EdgeTypes` required — Svelte component type doesn't satisfy the generic. This is a known pattern in the codebase (see `ChapterDAG.svelte` nodeTypes). |
| `@sveltejs/kit` | 2.53.3 | AbortSignal.timeout() bug fixed in 2.21.1 — current version is safe. |
| `drizzle-orm` | 0.45.1 | LibSQL dialect for Turso is separate from SQLite. Ensure `drizzle.config.ts` uses `dialect: 'turso'` for production targets. |

---

## Sources

- [Svelte Flow Custom Edges docs](https://svelteflow.dev/learn/customization/custom-edges) — EdgeTypes API, BaseEdge, EdgeLabel — HIGH confidence
- [Svelte Flow BaseEdge API reference](https://svelteflow.dev/api-reference/components/base-edge) — BaseEdge props — HIGH confidence
- [Svelte Flow EdgeLabel API reference](https://svelteflow.dev/api-reference/components/edge-label) — EdgeLabel x/y props — HIGH confidence
- [Anthropic Pricing docs](https://platform.claude.com/docs/en/about-claude/pricing) — usage object structure, token pricing — HIGH confidence
- [OpenRouter API reference](https://openrouter.ai/docs/api/reference/overview) — usage.cost, prompt_tokens, completion_tokens — HIGH confidence (verified)
- [SvelteKit issue #13874](https://github.com/sveltejs/kit/issues/13874) — AbortSignal.timeout() fix in 2.21.1 — HIGH confidence
- [Valibot comparison guide](https://valibot.dev/guides/comparison/) — bundle size 1.37 kB vs Zod 17.7 kB — HIGH confidence
- [Drizzle + Turso docs](https://orm.drizzle.team/docs/drizzle-with-turso) — push vs migrate workflow — MEDIUM confidence (verified pattern matches existing project scripts)

---

*Stack research for: Minion Hub v2.0 Skill Builder Improvements*
*Researched: 2026-03-18*
