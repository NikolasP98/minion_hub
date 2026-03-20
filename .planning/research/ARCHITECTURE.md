# Architecture Research

**Domain:** Skill builder feature improvements (validation, versioning, cost tracking, data flow viz)
**Researched:** 2026-03-18
**Confidence:** HIGH (all findings based on direct codebase inspection)

## Standard Architecture

### System Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        Browser (SvelteKit)                       │
├──────────────────────┬──────────────────────────────────────────┤
│  Left Page (metadata)│          Right Page (DAG canvas)          │
│  +page.svelte        │          ChapterDAG.svelte                │
│  - skill name/desc   │          - @xyflow/svelte nodes/edges     │
│  - tool pool display │          - ConditionNode custom type      │
│  - AI build btn      │          - context menu                   │
│  - validation panel  │                                           │
│  - modals (inline)   │                                           │
├──────────────────────┴──────────────────────────────────────────┤
│               Shared lib ($lib/*)                                │
│  components/builder/   data/          utils/                     │
│  ChapterEditor.svelte  tool-manifest  (graph, validation, cost)  │
│  ChapterDAG.svelte     (ToolInfo)                                │
│  ConditionNode.svelte                                            │
│  SkillPreview.svelte                                             │
│  EmojiPicker.svelte                                              │
├─────────────────────────────────────────────────────────────────┤
│                   SvelteKit API Routes                           │
│  /api/builder/skills/[id]  (PUT multi-action dispatcher)         │
│  /api/builder/skills/[id]/chapter-tools/[chapterId]              │
│  /api/builder/ai/suggest-skill                                   │
│  /api/builder/ai/suggest-chapter                                 │
│  /api/builder/skills/[id]/versions  (NEW)                        │
├─────────────────────────────────────────────────────────────────┤
│                   Server Services ($server/*)                    │
│  services/builder.service.ts          db/schema/builder.ts       │
│  services/builder-versions.service.ts (NEW)                      │
│  auth/tenant-ctx.ts                                              │
├─────────────────────────────────────────────────────────────────┤
│              Drizzle ORM + LibSQL / Turso                        │
│  built_skills  built_chapters  built_chapter_edges               │
│  built_chapter_tools  built_skill_tools  built_agents            │
│  built_skill_versions  (NEW)                                     │
└─────────────────────────────────────────────────────────────────┘
```

### Component Responsibilities

| Component | Responsibility | Location |
|-----------|----------------|----------|
| `+page.svelte` | Orchestrates all editor state; calls all API routes; owns validation `$derived` | `src/routes/(app)/builder/skills/[id]/` |
| `ChapterDAG.svelte` | Wraps `@xyflow/svelte`; translates chapter/edge data to Flow nodes; fires callbacks up | `src/lib/components/builder/` |
| `ConditionNode.svelte` | Custom SvelteFlow node type for condition diamonds; exposes `yes`/`no` handles | `src/lib/components/builder/` |
| `ChapterEditor.svelte` | Multi-step modal (zag-js Steps); chapter field editing + AI suggest | `src/lib/components/builder/` |
| `SkillPreview.svelte` | Read-only topological view with validation checklist; shown pre-publish | `src/lib/components/builder/` |
| `builder.service.ts` | All DB operations; `validateSkillForPublish`; `TenantContext` pattern | `src/server/services/` |
| `tool-manifest.ts` | Static tool metadata lookup (`getToolInfo`, `getAllTools`); `ToolInfo` type | `src/lib/data/` |
| `suggest-skill` API | OpenRouter tool-calling; returns `{ chapters[], edges[] }` | `src/routes/api/builder/ai/` |
| `suggest-chapter` API | OpenRouter tool-calling; returns per-chapter field suggestions | `src/routes/api/builder/ai/` |

## Recommended Project Structure (New Files)

```
src/
├── lib/
│   ├── components/builder/
│   │   ├── ValidationPanel.svelte        # extracted from +page.svelte (new component)
│   │   ├── SkillVersionHistory.svelte    # version list + restore (new)
│   │   ├── CostBadge.svelte              # token/cost display pill (new)
│   │   ├── DataFlowEdge.svelte           # custom SvelteFlow edge with upstream preview (new)
│   │   └── AISkillPreview.svelte         # staged import review before apply (new)
│   ├── utils/
│   │   ├── dag-validation.ts             # shared pure validation functions (new)
│   │   └── token-cost.ts                 # token → cost calculation utils (new)
│   └── data/
│       └── tool-manifest.ts              # extend with category field (modify)
│
├── server/
│   ├── db/schema/
│   │   └── builder.ts                    # add built_skill_versions table (modify)
│   └── services/
│       ├── builder.service.ts            # batch inserts, N+1 fixes (modify)
│       └── builder-versions.service.ts   # snapshot/restore operations (new)
│
└── routes/api/builder/
    └── skills/[id]/
        └── versions/+server.ts           # GET list, POST create snapshot (new)
```

### Structure Rationale

- **`$lib/utils/dag-validation.ts`:** Shared between `+page.svelte` (client-side `$derived` panel) and `builder.service.ts` is NOT possible — `$server` cannot import from `$lib/utils` at compile time with Vite's module graph unless the file is pure TS with no browser dependencies. Put validation in `$lib/utils/` (pure functions, no DOM/Svelte). The server service can import it via the vite alias since it's SSR-executed. The page component also imports it directly.
- **`$lib/utils/token-cost.ts`:** Cost math is pure arithmetic; belongs in `$lib/utils/` alongside `format.ts`. Used by both the AI API response display (client) and potentially server-side cost guardrails.
- **`builder-versions.service.ts`:** Isolated from `builder.service.ts` to keep the main service focused; follows same `TenantContext` pattern.

## Architectural Patterns

### Pattern 1: Multi-Action PUT Dispatcher

**What:** A single `PUT /api/builder/skills/:id` endpoint dispatches on a `body.action` discriminant field rather than separate endpoints per mutation.

**When to use:** The existing pattern for all chapter/edge/tool mutations. New actions (e.g., `create-version`) should follow this convention on the skill route. Version-specific actions (`restore`, `diff`) get their own `/versions` sub-route because they are semantically distinct resources.

**Example:**
```typescript
// In +server.ts PUT handler — add after existing actions
if (action === 'create-version') {
  const { label, changelog } = body;
  const { id } = await createSkillVersion(ctx, params.id!, { label, changelog });
  return json({ id });
}
```

### Pattern 2: TenantContext Pass-Through

**What:** Every service function takes `ctx: TenantContext` as first argument. Auth is resolved once at the API route entry point via `getOrCreateTenantCtx(locals)`.

**When to use:** All new service functions must follow this — no service function resolves tenancy itself.

**Example:**
```typescript
// builder-versions.service.ts
export async function createSkillVersion(
  ctx: TenantContext,
  skillId: string,
  opts: { label?: string; changelog?: string }
) {
  // snapshot current state into built_skill_versions
}
```

### Pattern 3: Pure Validation in `$lib/utils/`

**What:** Validation logic that runs on both client (Svelte `$derived`) and server (service layer) is extracted to pure TypeScript functions in `$lib/utils/dag-validation.ts`. No Svelte reactivity, no DB calls.

**When to use:** The cycle detection DFS, condition text validation, and the chapter completeness checks are duplicated between `+page.svelte` and `builder.service.ts`. Extracting them removes the duplication and ensures client/server validation agree.

**Example:**
```typescript
// src/lib/utils/dag-validation.ts
export interface ValidationFinding {
  level: 'error' | 'warning' | 'ok';
  message: string;
  chapterIds?: string[];  // which chapters triggered this finding
}

export function validateDAGStructure(
  chapters: ChapterLike[],
  edges: EdgeLike[]
): ValidationFinding[] { ... }

export function validateConditionText(text: string): { valid: boolean; reason?: string } { ... }

export function detectCycle(chapters: ChapterLike[], edges: EdgeLike[]): boolean { ... }
```

The server's `validateSkillForPublish` calls these same functions after loading from DB. The page's `validationFindings $derived` also calls them with in-memory state.

### Pattern 4: Custom SvelteFlow Edge Type for Data Flow

**What:** SvelteFlow (`@xyflow/svelte`) supports `edgeTypes` the same way it supports `nodeTypes`. A custom `DataFlowEdge.svelte` component renders the edge path plus an upstream-output tooltip/popover showing the source chapter's `outputDef`.

**When to use:** When the edge label space is insufficient for full context. The custom edge receives `data` prop with `sourceOutputDef` and `targetContextExpectation` strings. These are passed in `flowEdges` construction inside `ChapterDAG.svelte`.

**Example (ChapterDAG.svelte modification):**
```typescript
// Add to edgeTypes
const edgeTypes = { dataflow: DataFlowEdge } as unknown as EdgeTypes;

// In flowEdges $derived — enrich edge data
const flowEdges: Edge[] = $derived(
  edges.map(e => {
    const src = chapters.find(ch => ch.id === e.sourceChapterId);
    const tgt = chapters.find(ch => ch.id === e.targetChapterId);
    return {
      id: e.id,
      source: e.sourceChapterId,
      target: e.targetChapterId,
      type: 'dataflow',        // use custom edge
      data: {
        label: e.label,
        sourceOutputDef: src?.outputDef ?? '',
        targetContextExpectation: tgt?.context ?? '',
      },
      ...
    };
  })
);
```

### Pattern 5: Staged Import Preview (AISkillPreview)

**What:** The AI-build flow currently applies changes immediately after the API response. The staged import pattern inserts a review step: AI response is held in local state, rendered in `AISkillPreview.svelte`, and the user confirms or rejects before any API writes occur.

**Component boundary:**
- `AISkillPreview.svelte` is a **read-only preview modal** — it receives `{ chapters, edges }` from the AI response and renders them the same way `SkillPreview.svelte` renders persisted data. It has two props: `onConfirm(data)` and `onCancel()`.
- The parent `+page.svelte` holds `pendingAIResult = $state<AIResult | null>(null)`. When set, the preview shows. On confirm, the existing `buildSkillWithAI` write loop runs. On cancel, `pendingAIResult` is cleared.

**This is a UI-only pattern** — no new API routes, no schema changes.

```typescript
// In +page.svelte
let pendingAIResult = $state<{ chapters: AIChapter[]; edges: AIEdge[] } | null>(null);

// In buildSkillWithAI — replace immediate write with preview
const data = await res.json();
if (!data.chapters?.length) throw new Error('AI returned no chapters');
pendingAIResult = data;  // show preview instead of writing immediately

async function confirmAIBuild(data: { chapters: AIChapter[]; edges: AIEdge[] }) {
  pendingAIResult = null;
  // ... existing write loop from buildSkillWithAI ...
}
```

### Pattern 6: AbortController Timeouts

**What:** Wrap all `fetch()` calls to AI endpoints and skill saves with an `AbortController` and `setTimeout`. AI calls (suggest-skill, suggest-chapter) warrant 30s timeouts; regular CRUD calls warrant 8s.

**Where to add:**
1. `buildSkillWithAI()` — the `fetch('/api/builder/ai/suggest-skill', ...)` call
2. `ChapterEditor.svelte` — the `fetch('/api/builder/ai/suggest-chapter', ...)` call
3. `saveSkill()` — the metadata PUT (8s is sufficient; network loss shouldn't hang the UI)
4. Server-side in `suggest-skill/+server.ts` and `suggest-chapter/+server.ts` — the `fetch(OPENROUTER_URL, ...)` call should have a server-side timeout (25s, leaving 5s buffer before any client-side abort)

**Pattern (client-side):**
```typescript
const controller = new AbortController();
const timeout = setTimeout(() => controller.abort(), 30_000);
try {
  const res = await fetch(url, { ...options, signal: controller.signal });
  // ...
} finally {
  clearTimeout(timeout);
}
```

**Pattern (server-side, in AI route handlers):**
```typescript
const controller = new AbortController();
const timeout = setTimeout(() => controller.abort(), 25_000);
try {
  const res = await fetch(OPENROUTER_URL, { ...body, signal: controller.signal });
  // ...
} finally {
  clearTimeout(timeout);
}
```

## Data Flow

### Versioning Table Relationship

```
built_skills (1) ──────────────────── (N) built_skill_versions
  id TEXT PK                               id TEXT PK
  name, description, ...                   skillId TEXT FK → built_skills.id
  status draft|published                   versionNumber INTEGER  (auto-increment per skill)
  updatedAt INTEGER                        label TEXT (e.g. "Before AI rebuild")
                                           changelog TEXT
                                           snapshotJson TEXT  (full JSON blob of skill state)
                                           createdAt INTEGER
                                           createdBy TEXT
```

**Snapshot strategy:** Store a complete JSON snapshot rather than a diff. The skill state is small (chapters are ~100-500 bytes each, typical skills have 2-8 chapters). A full snapshot at ~5KB per version is trivial storage. This avoids replay complexity entirely.

**Snapshot content** (what `snapshotJson` contains):
```typescript
interface SkillSnapshot {
  skill: { name, description, emoji, maxCycles, status };
  chapters: Array<{ id, name, type, guide, context, outputDef, conditionText, positionX, positionY }>;
  edges: Array<{ id, sourceChapterId, targetChapterId, label }>;
  chapterTools: Record<string, string[]>;  // chapterId → toolIds
}
```

**Restore path:** `POST /api/builder/skills/[id]/versions/[versionId]/restore` writes all snapshot fields back to their respective tables, wrapped in a single DB transaction.

**Drizzle migration strategy:** Add a new `built_skill_versions` table to `builder.ts`. Run `bun run db:push` for dev (schema push, no migration files). For production (Turso), use `bun run db:generate && bun run db:migrate`.

### AI Generation Data Flow (with Staged Preview)

```
User clicks "Build chapters with AI"
    ↓
+page.svelte: fetch POST /api/builder/ai/suggest-skill (30s timeout)
    ↓
Server: OpenRouter tool-calling call (25s timeout) → parsed { chapters[], edges[] }
    ↓
+page.svelte: pendingAIResult = data → AISkillPreview modal opens
    ↓
User reviews → clicks "Apply" or "Cancel"
    ↓ (Apply)
Sequential API writes (N+1 issue → batch endpoint or Promise.all)
    ↓
Local state update → ChapterDAG re-renders
```

### N+1 Fix for AI-Generated Skill Import

The current `buildSkillWithAI` loop calls one API per chapter (create) + one per chapter (update metadata) + one per chapter (set tools) = 3N sequential fetches. The fix:

**Option A (recommended):** Add a `action: 'batch-add-chapters'` action to the PUT handler that accepts an array of chapters+tools and writes them in a transaction in a single round trip. The service uses `ctx.db.batch()` (libsql supports batch mode) or a loop inside a single request.

**Option B:** `Promise.all` the chapter creates to run in parallel (still N round trips but not sequential). Simpler, acceptable for typical skill sizes of 2-8 chapters.

**Recommendation:** Option A (batch action) for correctness and atomicity. If the AI import fails halfway through Option B, you get a partial skill state.

### Validation Data Flow

```
Client ($derived, reactive)
  +page.svelte: validationFindings = $derived(validateDAGStructure(chapters, edges))
      ↓ displayed in ValidationPanel.svelte (toggle panel in toolbar)
      ↓ publish button disabled when validationCounts.errors > 0

Server (on publish action)
  PUT /api/builder/skills/:id { action: 'publish' }
      ↓ validateSkillForPublish(ctx, skillId) — loads from DB, calls same pure functions
      ↓ returns 400 { errors[] } if invalid
      ↓ client shows structured error list (not just a banner string)
```

The key improvement: errors come back as `string[]` already. The client currently joins them with `'; '` and shows a flat banner. The fix is to render them as a list — no API change needed.

### Cost Tracking Data Flow

```
AI endpoint (suggest-skill, suggest-chapter)
    ↓ OpenRouter response includes usage: { prompt_tokens, completion_tokens, total_tokens }
    ↓ Server extracts usage from completion.usage
    ↓ Returns { chapters, edges, usage: { promptTokens, completionTokens, totalTokens } }
    ↓
+page.svelte: receives usage in AI response
    ↓ token-cost.ts: estimateCost(model, usage) → dollars
    ↓ CostBadge.svelte displays "~$0.004 (1,247 tok)" in toolbar
```

**token-cost.ts module design:**
```typescript
// src/lib/utils/token-cost.ts
export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

// Rates in USD per million tokens (update as models change)
const MODEL_RATES: Record<string, { input: number; output: number }> = {
  'anthropic/claude-sonnet-4': { input: 3.0, output: 15.0 },
  // fallback
  'default': { input: 3.0, output: 15.0 },
};

export function estimateCost(model: string, usage: TokenUsage): number {
  const rates = MODEL_RATES[model] ?? MODEL_RATES['default'];
  return (usage.promptTokens / 1_000_000) * rates.input
       + (usage.completionTokens / 1_000_000) * rates.output;
}

export function formatCost(usd: number): string {
  if (usd < 0.001) return '<$0.001';
  return `~$${usd.toFixed(3)}`;
}
```

No DB persistence needed for Phase 1 cost display. If budget caps are needed later, a `built_skill_ai_usage` table can be added.

## Build Order (Dependency-Aware)

| Step | Change | Why This Order |
|------|--------|----------------|
| 1 | Extract `dag-validation.ts` to `$lib/utils/` | Required before fixing server validation divergence and publish button gate |
| 2 | Wire `dag-validation.ts` into server `validateSkillForPublish` | Needs step 1 |
| 3 | Fix publish button: disable on `validationCounts.errors > 0` | Needs step 1 (client uses same functions) |
| 4 | Extract `ValidationPanel.svelte` from `+page.svelte` | Needs step 1 (receives `ValidationFinding[]`) |
| 5 | Add `AbortController` to `saveSkill()` and `buildSkillWithAI()` | Independent; do early |
| 6 | Add `token-cost.ts` utility | Independent of everything |
| 7 | Return `usage` from AI API routes | Needs step 6 (CostBadge consumes it) |
| 8 | Add `CostBadge.svelte` to toolbar | Needs step 7 |
| 9 | Add `AISkillPreview.svelte` (staged import) | Needs no schema changes; builds on existing SkillPreview.svelte patterns |
| 10 | Wire staged import into `buildSkillWithAI` | Needs step 9 |
| 11 | Add `batch-add-chapters` action to PUT handler + service | N+1 fix; needs step 10 (import loop needs to use it) |
| 12 | Add `DataFlowEdge.svelte` custom edge | Independent of validation/cost; needs ChapterDAG familiarity |
| 13 | Wire edge type into `ChapterDAG.svelte` | Needs step 12 |
| 14 | Add `built_skill_versions` table to schema + `db:push` | Schema change; do before service |
| 15 | Add `builder-versions.service.ts` | Needs step 14 |
| 16 | Add `versions/+server.ts` API route | Needs step 15 |
| 17 | Add `SkillVersionHistory.svelte` + wire into editor | Needs step 16 |

## Anti-Patterns

### Anti-Pattern 1: Putting Validation in `$server/` Only

**What people do:** Keep `validateSkillForPublish` purely server-side and call it via API to populate the client validation panel.

**Why it's wrong:** Adds a round-trip on every keystroke (or requires debouncing), introduces latency in the panel, and means the publish button gate depends on an async call instead of a synchronous `$derived`.

**Do this instead:** Extract pure validation to `$lib/utils/dag-validation.ts`. Both client and server import from it. The server still validates on publish (defense in depth), but the client validates reactively with no API call.

### Anti-Pattern 2: Importing `$server/` from Client Components

**What people do:** Try to import from `$server/services/builder.service.ts` in a `.svelte` component to share validation logic.

**Why it's wrong:** SvelteKit enforces the `$server` boundary via Vite. Any component that imports from `$server/` will cause a build error if referenced in a client context. The `+page.svelte` is isomorphic (runs on server for SSR, on client for hydration), but components within it that use `$server` imports in reactive context will fail.

**Do this instead:** Pure logic goes in `$lib/utils/`, which has no module boundary restriction.

### Anti-Pattern 3: Per-Chapter API Calls in AI Import

**What people do:** Loop `for (const ch of data.chapters) { await fetch(...) }` — the current pattern in `buildSkillWithAI`.

**Why it's wrong:** 8 chapters = 24 sequential HTTP requests minimum. On slow connections this is a 2-5 second wait for a visible operation that could be a single request.

**Do this instead:** `action: 'batch-add-chapters'` that accepts `{ chapters: ChapterInput[], edges: EdgeInput[] }` and writes everything in one transaction server-side. Client sends one request, receives one `{ chapterIds: string[], edgeIds: string[] }` response.

### Anti-Pattern 4: Storing Version Diffs

**What people do:** Store only what changed between versions (diff format) to save space.

**Why it's wrong:** Skill state is small (< 10KB per version in practice). Diff storage requires replay complexity to restore a version and makes "what was in version 3?" queries require replaying all prior diffs. Snapshot storage is simpler and sufficiently cheap.

**Do this instead:** Store full `snapshotJson` blobs. If storage ever matters, compress with a lib — but at current scale it won't.

### Anti-Pattern 5: SvelteFlow Edge `label` for Full Data Flow Context

**What people do:** Put the full `outputDef` text as the SvelteFlow edge `label` prop.

**Why it's wrong:** Edge labels in SvelteFlow render inline on the edge path with limited space. Multi-line text overflows the canvas and breaks the layout. `outputDef` can be several sentences long.

**Do this instead:** Use a custom edge component (`DataFlowEdge.svelte`) that renders the edge path normally, and shows a hover tooltip or small inline badge. The tooltip reveals the full upstream output definition and downstream context expectation on hover.

## Integration Points

### New vs Modified Files

| File | Status | Change |
|------|--------|--------|
| `src/lib/utils/dag-validation.ts` | NEW | Pure validation functions extracted from page + server |
| `src/lib/utils/token-cost.ts` | NEW | Cost estimation utilities |
| `src/lib/components/builder/ValidationPanel.svelte` | NEW | Extracted validation panel (was inline in +page.svelte) |
| `src/lib/components/builder/CostBadge.svelte` | NEW | Token/cost display in toolbar |
| `src/lib/components/builder/AISkillPreview.svelte` | NEW | Staged import review modal |
| `src/lib/components/builder/DataFlowEdge.svelte` | NEW | Custom SvelteFlow edge with upstream preview |
| `src/lib/components/builder/SkillVersionHistory.svelte` | NEW | Version list panel |
| `src/server/db/schema/builder.ts` | MODIFY | Add `builtSkillVersions` table |
| `src/server/services/builder.service.ts` | MODIFY | Fix N+1 (batch insert), fix tool filtering, extract validation calls |
| `src/server/services/builder-versions.service.ts` | NEW | Snapshot/restore/list operations |
| `src/routes/api/builder/skills/[id]/+server.ts` | MODIFY | Add `batch-add-chapters` action |
| `src/routes/api/builder/skills/[id]/versions/+server.ts` | NEW | GET versions list, POST create snapshot |
| `src/routes/api/builder/ai/suggest-skill/+server.ts` | MODIFY | Add server timeout, return `usage` in response |
| `src/routes/api/builder/ai/suggest-chapter/+server.ts` | MODIFY | Add server timeout, return `usage` in response |
| `src/routes/(app)/builder/skills/[id]/+page.svelte` | MODIFY | Wire validation panel, cost badge, staged preview, AbortController, disable publish on errors |
| `src/lib/components/builder/ChapterDAG.svelte` | MODIFY | Add `edgeTypes`, enrich edge data for DataFlowEdge |
| `src/lib/data/tool-manifest.ts` | MODIFY | Add `category` field to `ToolInfo` (needed for expanded tool cards) |

### Internal Boundaries

| Boundary | Communication | Constraint |
|----------|---------------|------------|
| `$lib/utils/dag-validation.ts` ↔ `+page.svelte` | Direct import, used in `$derived` | Must be pure TS (no Svelte runes, no DOM) |
| `$lib/utils/dag-validation.ts` ↔ `builder.service.ts` | Direct import | Server imports `$lib/utils/` without restriction (SSR context) |
| `DataFlowEdge.svelte` ↔ `ChapterDAG.svelte` | `edgeTypes` prop on `SvelteFlow` | Must match `@xyflow/svelte` edge component API: receives `{ id, source, target, data, ... }` as `$props()` |
| `AISkillPreview.svelte` ↔ `+page.svelte` | Props + callback (`onConfirm`, `onCancel`) | Preview is stateless — all data passed as props, no internal API calls |
| `builder-versions.service.ts` ↔ versions API route | Direct function calls, same `TenantContext` pattern | No new auth mechanism needed |

## Scaling Considerations

| Concern | Current Scale | Notes |
|---------|---------------|-------|
| Version snapshots | Single user, < 100 skills | Full JSON blobs are fine; no compression needed |
| AI import batch writes | 2-8 chapters per import | Batch endpoint eliminates N+1; single transaction prevents partial state |
| Validation reactivity | Real-time `$derived` on every keystroke | Pure functions with no async; performance not a concern at any skill size |
| Tool manifest | 9 static tools | Extend the manifest statically; dynamic tool registration not needed in this milestone |

## Sources

- Direct inspection of `src/server/db/schema/builder.ts` (schema)
- Direct inspection of `src/server/services/builder.service.ts` (service layer)
- Direct inspection of `src/routes/(app)/builder/skills/[id]/+page.svelte` (editor page, 1789 lines)
- Direct inspection of `src/lib/components/builder/ChapterDAG.svelte` (SvelteFlow integration)
- Direct inspection of `src/lib/components/builder/SkillPreview.svelte` (existing preview pattern)
- Direct inspection of `src/routes/api/builder/ai/suggest-skill/+server.ts` (AI endpoint)
- Direct inspection of `src/routes/api/builder/ai/suggest-chapter/+server.ts` (AI endpoint)
- Direct inspection of `src/lib/data/tool-manifest.ts` (tool registry)
- Direct inspection of `src/server/auth/tenant-ctx.ts` (auth pattern)

---
*Architecture research for: skill builder improvements (validation UX, versioning, cost tracking, data flow viz)*
*Researched: 2026-03-18*
