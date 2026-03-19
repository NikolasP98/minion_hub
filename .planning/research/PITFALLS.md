# Pitfalls Research

**Domain:** Adding validation UX, versioning, cost tracking, and data flow visualization to an existing SvelteKit + Svelte 5 + @xyflow/svelte workflow builder
**Researched:** 2026-03-18
**Confidence:** HIGH — all pitfalls grounded in the actual codebase, not generic advice

---

## Critical Pitfalls

### Pitfall 1: +page.svelte God-Component Collapse

**What goes wrong:**
`+page.svelte` is already ~600 lines with 20+ reactive state variables, 15+ async functions, and inline business logic (DFS cycle detection at lines 570-595, inline validation at lines 514-598). Adding validation panel state, version drawer state, cost tracking state, and data flow overlay state directly to the file pushes it past the point where any single change has predictable scope. The CONCERNS.md doc already flags `WorkshopCanvas.svelte` (1586 lines) and `AgentCard.svelte` (807 lines) as fragile precisely because they mix data fetching, UI state, and business logic.

**Why it happens:**
The page already owns skill loading, auto-save, publish, AI generation, chapter CRUD, edge CRUD, condition node logic, and validation. Each new feature feels like "just one more state variable and one more function." The first addition rarely breaks things; it's the fourth or fifth that makes the file incomprehensible.

**How to avoid:**
Extract state into dedicated `.svelte.ts` modules before adding new features. Create `src/lib/state/builder/skill-editor.svelte.ts` to own chapters, edges, chapterToolMap, saving, dirty, validation findings — everything currently inline in the page. The page becomes a thin coordinator: load, bind, delegate. New features (versioning, cost) get their own state modules (`skill-versions.svelte.ts`, `skill-cost.svelte.ts`). This is the exact pattern already used everywhere else in the codebase (`reliability`, `workshop`, `config` all have dedicated state subdirectories).

**Warning signs:**
- The `$state` declaration count in the page exceeds 25
- A new developer cannot locate "where does saving happen?" without grep
- `$effect` blocks reference 5+ reactive values
- The template section (markup) grows past 300 lines

**Phase to address:**
Before any new feature phase. This is a prerequisite refactor, not a separate polish task. Attempting to add versioning or cost tracking without extracting state first will compound the debt and make the extraction harder afterward.

---

### Pitfall 2: Client/Server Validation Divergence

**What goes wrong:**
The page already has client-side validation in `$derived.by()` at lines 514-598 (`validationFindings`) and server-side validation in `builder.service.ts` (`validateSkillForPublish`). The two do not share the same rule set. The server checks chapter type (`type === 'chapter'` vs `type === 'condition'`) but the client checks `!ch.guide?.trim()` for ALL chapters without checking `type`. The server checks tool count per chapter via a DB query; the client checks `chapterToolMap` (in-memory). If these drift, users see green checkmarks client-side but get publish errors server-side — the worst UX outcome: "looks done but isn't."

**Why it happens:**
Client validation runs against in-memory state (no DB access); server validation queries the DB. Developers naturally write them separately and they diverge as rules evolve. The temptation is to add a new rule only on the server ("it'll be caught at publish time") or only on the client ("it's just UX, not enforced").

**How to avoid:**
Extract all pure validation rules (those that don't require DB access) into a shared module at `src/lib/utils/skill-validation.ts`. This module exports functions that accept the skill graph as plain data objects — not DB queries. Server validation imports and calls these same functions before its DB-backed checks. This is achievable because the page already passes `chapters`, `chapterEdges`, and `chapterToolMap` as plain in-memory structures.

The split must be explicit:
- `validateSkillGraph(skill, chapters, edges, toolMap): ValidationResult` — pure, runs anywhere
- `validateSkillForPublish(ctx, skillId): ValidationResult` — calls `validateSkillGraph` then adds DB-backed checks (e.g., confirms tool IDs actually exist in gateway records)

**Warning signs:**
- A validation error appears at publish time that the client panel showed as "OK"
- A client warning appears for something the server never blocks
- The word "validation" appears in both `+page.svelte` and `builder.service.ts` with different logic

**Phase to address:**
Validation UX phase. Any phase that adds new validation rules must add them to the shared module, not to the page or service independently. Codify this as the acceptance criterion.

---

### Pitfall 3: Versioning Snapshot with Partial Writes (Torn Snapshot)

**What goes wrong:**
A skill version snapshot must capture: skill metadata + all chapters + all edges + all chapter tools — atomically. LibSQL/Turso supports transactions. If versioning is implemented as sequential inserts without a transaction (the pattern currently used for all builder operations, e.g., `setChapterTools` deletes then inserts in a loop), a snapshot can be torn: the chapter rows insert successfully but a chapter_tools insert fails halfway. The stored version represents a state that never actually existed.

**Why it happens:**
The existing builder service has zero use of transactions. Every operation is a standalone query. Developers following the established pattern will implement snapshotting the same way. The loop in `setChapterTools` (lines 217-222 of builder.service.ts) is the template — and it has no transaction wrapper.

**How to avoid:**
Use `ctx.db.transaction(async (tx) => { ... })` for the entire snapshot creation. Drizzle's transaction API wraps all inserts in a single SQLite transaction that rolls back atomically on any failure. The snapshot table schema must be designed to store the full denormalized graph (not FK references to the live chapters, since those are mutable). Store chapters and edges as a JSON blob inside the snapshot row — this also eliminates the N-table join to reconstruct a historical version.

Proposed snapshot schema:
```
built_skill_versions: id, skillId, versionNumber, snapshot (JSON blob), createdAt, label
```

Where `snapshot` is `{ skill: {...}, chapters: [...], edges: [...], toolMap: {...} }`.

**Warning signs:**
- Version snapshot service uses individual inserts in a for-loop
- No `ctx.db.transaction()` wrapper around snapshot creation
- Version table stores chapter IDs as foreign keys rather than a denormalized blob

**Phase to address:**
Versioning phase. The schema design review (before any code is written) must enforce the JSON blob + transaction approach.

---

### Pitfall 4: Stale Anthropic Pricing Data in Cost Estimates

**What goes wrong:**
Any cost estimation feature that hardcodes token prices (e.g., `const COST_PER_1K_TOKENS = { 'claude-opus-4': 0.015, 'claude-sonnet-4': 0.003 }`) becomes wrong the moment Anthropic adjusts pricing, adds a new model, or changes from per-token to per-character billing. The builder already uses Claude for AI generation and the model family will likely expand (claude-sonnet-4-5, claude-opus-5, etc.). A hardcoded table will show users confidently wrong numbers and erode trust when actual API bills differ.

**Why it happens:**
Pricing looks simple: a small lookup table, easy to hardcode, easy to display. The initial numbers will be accurate enough at implementation time. Developers rarely build in an update mechanism for "configuration data" that seems stable.

**How to avoid:**
Three-layer approach:

1. Store pricing in a configurable source (env var JSON or a DB row in a `config` table), not source code constants. This allows updates without a redeploy.
2. Mark all cost estimates as estimates, not invoices. UI copy: "~$0.02 estimated" with a tooltip: "Estimates use cached model pricing and may not reflect current Anthropic rates."
3. If implementing at all: fetch the Anthropic pricing page or use their API to get current model metadata. Cache for 24h. Fall back to hardcoded floor values if fetch fails.

If the effort to implement dynamic pricing exceeds the value (it likely does for a v2 milestone), the safest option is to display token counts only (input tokens, estimated output tokens), and let the user convert to cost using their actual plan. This future-proofs the feature entirely.

**Warning signs:**
- Any file containing `PRICE_PER_TOKEN` or similar constants
- Model names hardcoded alongside numeric price values
- No "estimated" disclaimer in the UI

**Phase to address:**
Cost tracking phase. Architecture decision must be made before implementation: display tokens only, or display cost with disclaimers. Avoid the hybrid of displaying hardcoded costs without disclaimers.

---

### Pitfall 5: SvelteFlow `$derived` Edge Array Causing Full Re-render on Every Parent State Change

**What goes wrong:**
`ChapterDAG.svelte` derives `flowEdges` and `flowNodes` as `$derived` arrays from `chapters` and `edges` props. Adding edge labels for data flow visualization means the edge objects carry more data (upstream output definitions, node colors, label text derived from chapter `outputDef`). If the derived computation is expensive or if adding more reactive dependencies causes it to recompute on unrelated state changes (e.g., the validation findings updating in the parent), SvelteFlow re-renders the entire canvas on every keystroke in the sidebar.

The specific danger: when the page extracts validation findings as a `$derived.by()` that depends on `chapters` and `chapterEdges`, and the edge label derivation in `ChapterDAG` also depends on `chapters` (to read `outputDef` for label text), a chapter text edit triggers: validation recompute → edge label recompute → SvelteFlow full diff → canvas re-render. This is imperceptible at 5 nodes but noticeable at 20+.

**Why it happens:**
Svelte 5 `$derived` is pure and granular but doesn't memo-ize object identity. Each re-derivation produces new array objects even if the values are identical, which triggers SvelteFlow's internal change detection.

**How to avoid:**
- Keep edge label derivation in `ChapterDAG.svelte` lightweight: derive only from `edges` prop, not from `chapters`. Pass pre-computed label data from the parent as a prop (`edgeMetadata: Record<string, string>`).
- Use `$derived.by()` with an explicit equality check pattern for expensive computations: track a "DAG shape hash" (sorted edge list + chapter IDs) and only recompute visual data when the hash changes.
- For data flow visualization specifically: use a separate overlay component (`DataFlowOverlay.svelte`) that renders on top of SvelteFlow rather than modifying edge data. This keeps the SvelteFlow internal state stable while the overlay re-renders independently.

**Warning signs:**
- `flowEdges` derivation imports or depends on chapter content fields (guide, outputDef, context)
- SvelteFlow renders flicker when typing in a chapter's guide text field
- Adding a `console.log` inside the edges `$derived` shows it firing on every keystroke

**Phase to address:**
Data flow visualization phase. Before adding content-dependent edge labels, validate the render path does not create a direct dependency between chapter text fields and SvelteFlow edge objects.

---

### Pitfall 6: AbortController Leak in Svelte 5 Component Lifecycle

**What goes wrong:**
The page currently has no AbortController usage. When AI generation timeouts are added, the pattern:
```ts
const controller = new AbortController();
const timeout = setTimeout(() => controller.abort(), 30_000);
await fetch('/api/builder/ai/suggest-skill', { signal: controller.signal });
clearTimeout(timeout);
```
...is correct in isolation but leaks if the component is destroyed mid-request. If the user navigates away from `/builder/skills/[id]` while AI generation is running, the component unmounts but the fetch continues, and when it resolves it attempts to write to reactive state (`$state`) in a destroyed component. In Svelte 5 this throws a runtime warning and can produce a stale state update if the same route is visited again.

**Why it happens:**
AbortController cleanup requires `onDestroy` (or a cleanup function returned from `$effect`). The existing codebase uses `onMount` but has no `onDestroy` calls anywhere in the builder page. The pattern for adding cleanup is less obvious in Svelte 5 runes mode vs. Svelte 4 lifecycle functions.

**How to avoid:**
In Svelte 5 runes, `$effect` cleanup is the primary mechanism:
```ts
$effect(() => {
    return () => {
        // Cleanup runs when component is destroyed or effect re-runs
        if (abortController) abortController.abort();
        if (saveTimer) clearTimeout(saveTimer);
    };
});
```

For AbortControllers specifically: store them in `$state` variables and abort all of them in a single cleanup effect. The pattern:
```ts
let activeControllers = $state<AbortController[]>([]);

function createAbortable(timeoutMs: number): AbortController {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    ctrl.signal.addEventListener('abort', () => clearTimeout(timer), { once: true });
    activeControllers = [...activeControllers, ctrl];
    return ctrl;
}

$effect(() => {
    return () => {
        for (const ctrl of activeControllers) ctrl.abort();
    };
});
```

Note: the existing `saveTimer` (line 29 of the page) also leaks — it is never cleared in a `onDestroy`. This should be fixed in the same phase.

**Warning signs:**
- Any `AbortController` created inside an async function without a corresponding cleanup
- `saveTimer` not cleared when the component unmounts
- Svelte dev mode warnings about setting state on a destroyed component

**Phase to address:**
Error handling hardening phase. The AbortController pattern and the saveTimer leak are both cleanup hygiene issues that belong in the same phase as fetch timeout implementation.

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Inline `$derived.by()` validation in +page.svelte | Zero new files, fast to write | Diverges from server validation, grows unbounded, impossible to unit test | Never for publish-blocking rules |
| Hardcoded model pricing constants | Works today, no infrastructure needed | Goes stale, users see wrong numbers, trust damage | Only if displayed with "estimate" disclaimer and token-count fallback |
| Sequential inserts for version snapshots (no transaction) | Follows existing builder.service.ts pattern | Torn snapshots on partial failure, silent data corruption | Never for snapshot creation |
| Copy-pasting validation logic from server to client | Fast to implement | Two code paths that drift apart silently | Never — extract shared module |
| Adding edge label data derived from chapter content in SvelteFlow | Simple, single-pass derivation | Canvas re-renders on every keystroke | Acceptable only if chapters array is small and re-render is imperceptible |
| `let controller: AbortController` scoped to async function | Simple, readable | Leaks on component unmount | Never for requests that outlive the initiating function |

---

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| @xyflow/svelte edges | Passing chapter content fields (outputDef, guide) directly into edge `data` object | Pass only edge metadata (id, label, type); derive display text in a separate overlay |
| @xyflow/svelte custom edges | Registering custom edge types with `edgeTypes` prop using a new object literal on every render | Define `edgeTypes` as a module-level constant (outside the component) to prevent SvelteFlow from treating it as changed every render |
| Drizzle + LibSQL transactions | Using `ctx.db.transaction()` vs `ctx.db.batch()` | For snapshot writes use `transaction()` (rollback on failure); for independent inserts use `batch()` for throughput |
| Anthropic API cost tracking | Reading `usage` from the API response after tool/function calls | The `usage` field on tool-call responses includes only the current call; accumulate across multiple turns if the AI uses multi-turn tool calling |
| SvelteKit `$effect` cleanup | Returning cleanup from inside an async `$effect` | The cleanup return must be synchronous; async cleanup must be handled separately (abort the controller, but do not await anything in the cleanup function) |
| Shared validation module | Importing `$server` path aliases in the shared validation module | Shared validation must live under `$lib`, not `$server`, so it can run in the browser; never import Drizzle or DB clients in the shared module |

---

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| `flowEdges` derived from chapter content fields | Canvas flickers on text input in chapter editor | Derive edges only from edge list, pass content via separate prop | Any chapter count with real-time text editing |
| `Promise.all` for chapter tool loading on page load | N parallel requests, one per chapter; noisy in DevTools; slow on large skills | Add a single `/api/builder/skills/[id]/all-chapter-tools` bulk endpoint | Skills with 5+ chapters |
| Snapshot JSON blob unbounded growth | Version history API response becomes large | Paginate version list; don't return full snapshot blob in list endpoint, only in detail endpoint | Skills with 50+ versions |
| Validation `$derived.by()` running DFS on every render | CPU spike during rapid edits; DFS is O(V+E) | Memoize cycle check behind a hash of the edge list | DAGs with 20+ nodes |

---

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| Storing cost tracking totals client-side only | Totals can be manipulated; no audit trail | Store token usage in DB against skillId; use server-reported `usage` from Anthropic API response, not client estimates |
| Returning full snapshot blobs in version list endpoint | Response size; snapshot may contain guide text with sensitive instructions | Version list returns `{ id, versionNumber, createdAt, label }` only; snapshot blob only on detail endpoint |
| Validating publish permission only on client | User can POST to `/api/builder/skills/[id]` with `action: 'publish'` while client shows validation errors | Server publish endpoint always runs `validateSkillForPublish` regardless of client state |

---

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| Showing validation errors only at publish time | User spends time building, hits wall at publish, unclear which chapter is wrong | Show inline warnings on chapter nodes in the DAG (red border, warning badge) as the user works |
| Error panel that lists raw error strings from the server | User sees "Chapter 'Web Research' has no tools assigned" with no navigation | Make each error message clickable; clicking navigates to the offending chapter and opens its editor |
| Version history with no label/changelog | User sees a list of timestamps with no context | Require or auto-generate a version label on each publish ("Published 2026-03-18 14:23") and allow optional manual label |
| Cost estimate shown as precise decimal (e.g., "$0.00847") | Implies precision that doesn't exist; confuses users | Show as range or round to 2 significant figures with "~" prefix |
| Auto-save indicator that doesn't distinguish save from publish | User unsure if changes are persisted or live | Separate "Saving draft..." from "Publishing..." with distinct visual states and distinct status indicators |

---

## "Looks Done But Isn't" Checklist

- [ ] **Shared validation module:** Verify the server's `validateSkillForPublish` imports and calls the shared client-side rules — not just parallel logic that happens to agree today
- [ ] **Version snapshot atomicity:** Verify snapshot creation uses a single `ctx.db.transaction()` — run a test where an insert in the middle fails and confirm no partial version is stored
- [ ] **AbortController cleanup:** Verify navigating away from the skill editor mid-AI-generation does not produce Svelte "setting state on destroyed component" warnings in dev mode
- [ ] **saveTimer leak:** Verify the existing 2s debounce timer is cleared on component destroy (currently it is not — line 29, never cleaned up)
- [ ] **Cost disclaimer present:** Verify any cost display includes "estimated" qualifier — not just in code comments but visible in the rendered UI
- [ ] **Version list vs. detail:** Verify the version list API does not return the full snapshot blob (only metadata); snapshot blob only on individual version GET
- [ ] **SvelteFlow edge stability:** Verify that typing in a chapter's guide text field does not trigger SvelteFlow canvas re-render (open DevTools, add a `console.log` in `flowEdges` derivation, type in the editor)
- [ ] **Client validation for condition nodes:** Verify client validation checks `ch.type === 'chapter'` before requiring tools — currently line 539 checks all chapters without type discrimination, matching what the server does not

---

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| God-component collapse (500+ line page) | HIGH | Extract state to `.svelte.ts` modules; this is mechanical but requires careful testing of every reactive binding |
| Torn version snapshot | MEDIUM | Add a `valid: boolean` column to version table; background job validates stored JSON against schema; surface invalid versions in UI; add transaction wrapper going forward |
| Client/server validation divergence | MEDIUM | Audit both rule sets side by side; extract shared module; add server integration test that calls publish API and asserts each expected error |
| Stale pricing data | LOW | Switch from constants to DB config row; update the row; no code change needed |
| AbortController leak | LOW | Add `$effect` cleanup; fix is 5 lines; risk is low because LibSQL is local and abandoned DB writes are not a problem |
| SvelteFlow performance regression | MEDIUM | Separate edge data derivation from chapter content; add Chrome Performance trace to confirm re-render path; may require refactoring data flow overlay into separate component |

---

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| God-component collapse | Phase 1 (state extraction prerequisite) | File line count < 300 after refactor; all state in `.svelte.ts` module |
| Client/server validation divergence | Phase 2 (validation UX) | Shared module exists; server calls it; unit tests cover rule parity |
| AbortController + saveTimer leaks | Phase 3 (error handling hardening) | Dev mode warning-free on navigate-away mid-request |
| Torn version snapshot | Phase 4 (skill versioning) | Transaction wrapper in snapshot service; integration test for partial failure |
| Stale pricing data | Phase 5 (cost tracking) | No hardcoded price constants; all displays show "~estimated" qualifier |
| SvelteFlow edge re-render | Phase 6 (data flow visualization) | No console.log fire in flowEdges derivation during chapter text edits |
| Custom edge type reference instability | Phase 6 (data flow visualization) | `edgeTypes` object defined at module level, not inline in template |

---

## Sources

- Direct codebase analysis: `src/routes/(app)/builder/skills/[id]/+page.svelte` (lines 1-600)
- Direct codebase analysis: `src/server/services/builder.service.ts` (lines 1-250)
- Direct codebase analysis: `src/lib/components/builder/ChapterDAG.svelte` (full file)
- Direct codebase analysis: `src/server/db/schema/builder.ts` (full file)
- Codebase concerns audit: `.planning/codebase/CONCERNS.md` (fragile areas, tech debt section)
- Phase context: `.planning/phases/05-builder-tab/05-CONTEXT.md` (original design decisions)
- Svelte 5 `$effect` cleanup behavior: training data (HIGH confidence — core runes API, stable since Svelte 5.0)
- @xyflow/svelte re-render behavior: training data + known React Flow / Svelte Flow behavior with object identity (MEDIUM confidence — verify with current @xyflow/svelte docs before implementation)
- Drizzle LibSQL transaction API: training data (MEDIUM confidence — verify `ctx.db.transaction()` signature in current Drizzle docs before versioning phase)

---
*Pitfalls research for: Skill Builder v2.0 — validation, versioning, cost tracking, data flow visualization*
*Researched: 2026-03-18*
