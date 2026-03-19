# Project Research Summary

**Project:** Minion Hub — Skill Builder v2.0 Improvements
**Domain:** Visual AI Workflow Builder (SvelteKit dashboard, subsequent milestone)
**Researched:** 2026-03-18
**Confidence:** HIGH

## Executive Summary

This milestone is a hardening pass on an already-shipped skill builder, not a greenfield feature. The existing stack (SvelteKit 2 + Svelte 5 runes, @xyflow/svelte 1.5.1, Drizzle ORM + LibSQL/Turso, OpenRouter AI) is fully adequate — zero new npm dependencies are required. The work falls into six improvement areas: validation UX (structured errors, disabled publish button, jump-to-node), cost/token display after AI generation, data flow edge visualization, staged AI import preview, skill versioning with named snapshots, and error handling hardening (AbortController timeouts, saveTimer cleanup). The recommended approach is to tackle these in dependency order: state extraction and shared validation infrastructure must come first, since five of the six areas depend on them.

The highest-value, lowest-risk changes are the validation panel and disabled publish button — these fix actively broken UX (users see a joined error string today) at minimal cost. The highest-risk area is skill versioning, which requires careful schema design (JSON snapshot blobs, not normalized tables) and transactional writes to avoid torn snapshots. Cost display is independent of everything else and should be shipped early since OpenRouter already returns `usage.cost` in the API response — the data is being silently discarded today.

The core risk across all phases is the `+page.svelte` god-component: it is already ~600 lines with inline business logic, and each new feature compounds the debt. The prerequisite refactor is extracting state to `.svelte.ts` modules (the pattern every other domain in this codebase already follows). Skipping this refactor and adding new features directly to the page will make the extraction progressively harder and eventual bugs progressively harder to diagnose.

---

## Key Findings

### Recommended Stack

No new packages are required. All milestone features are achievable from the existing installed stack. The three critical patterns are: (1) `AbortSignal.timeout(ms)` passed to `fetch()` — a Web-standard API available in Node 22 / Bun with no polyfill needed, (2) the `@xyflow/svelte` `edgeTypes` API with a `DataFlowEdge.svelte` component using `BaseEdge` + `EdgeLabel`, and (3) a new `built_skill_versions` Drizzle table using append-only JSON snapshot rows.

**Core technologies:**
- `@xyflow/svelte@1.5.1`: Custom edge types via `edgeTypes` prop — already in codebase, no upgrade needed
- `drizzle-orm@0.45.1` + `@libsql/client@0.17.0`: New `built_skill_versions` table — `db:push` for dev, `generate + migrate` for Turso production
- `AbortSignal.timeout()`: Web-standard timeout for all fetch calls — fixed in SvelteKit 2.21.1, current version (2.53.3) is safe
- Pure TypeScript: Shared validation module in `$lib/utils/` — no Zod/Valibot needed for structural checks at this complexity level
- `Intl.NumberFormat`: Built-in browser API for cost display formatting — no formatting library needed

**What NOT to add:**
- Zod/Valibot: 17.7 kB / 1.4 kB client bundle cost for checks that are 10 lines of TypeScript
- AI SDK (`@ai-sdk/anthropic`): Wraps a pattern that already works correctly with raw `fetch`
- SSE/EventSource: No streaming UX planned; current `fetch` + `json()` pattern is correct
- `drizzle-kit push` on production Turso for the versioning table (loses migration history)

---

### Expected Features

The competitor analysis (n8n, Dify, HighLevel, Langflow/Flowise, Vellum) reveals a clear P1/P2/P3 split. Every mature workflow builder ships structured validation errors with node-level indicators and jump-to-node navigation — the current joined-string banner is a known UX gap at every competitor. Version history is table stakes for cloud/enterprise tiers but open requests at Langflow and Flowise, making it a genuine differentiator at the self-hosted tier.

**Must have (table stakes — P1):**
- Structured validation error panel with chapter-level errors — current banner is actively broken UX
- Publish button disabled client-side when validation errors exist — every competitor blocks this
- Inline canvas node error indicators (red badge on broken chapters) — expected by any DAG builder user
- Jump-to-node from error list via SvelteFlow `fitView`/`setCenter` — HighLevel and VS Workflow Designer ship this
- Token/cost display after AI generation — every paid API user expects to see what was spent; data already available
- Edge label rendering in ChapterDAG — schema already has `label TEXT` field; UI doesn't render it

**Should have (differentiators — P2):**
- Version history (linear snapshots) with named labels and changelog — differentiator at self-hosted tier; n8n requires enterprise
- Staged AI import preview modal (accept/reject before DB writes) — no competitor ships this; addresses "AI overwrote my work" fear
- Upstream data preview in ChapterEditor (show outputDef of upstream chapters) — reduces context-switching on the canvas

**Defer (P3 / v3+):**
- Per-chapter cost attribution — requires per-call tracking infrastructure beyond the milestone scope
- Budget cap / generation abort — high complexity, token estimation is inherently unreliable (2-5x variance)
- Full visual diff between versions — DAG JSON diffs are unreadable; visual side-by-side comparison is major UI surface work
- Undo/redo on canvas — SvelteFlow does not ship this; implementing command-pattern state management over Svelte 5 runes is high complexity

---

### Architecture Approach

The builder is a two-panel SvelteKit page: left panel (metadata, validation, AI controls) + right panel (ChapterDAG SvelteFlow canvas). All mutations flow through a single `PUT /api/builder/skills/[id]` multi-action dispatcher. New components slot into this structure cleanly without architectural changes. The only structural addition is a `built_skill_versions` table and a `builder-versions.service.ts` service following the existing `TenantContext` pass-through pattern.

The key architectural decision is where to put shared validation logic. `$server/` imports fail in browser context. `$lib/utils/` is the correct home for pure TypeScript functions with no DB or DOM dependencies — both the page's reactive `$derived` and the server's `validateSkillForPublish` can import from there without any module boundary violations.

**Major components (new/modified):**
1. `$lib/utils/dag-validation.ts` (NEW) — pure validation functions shared between client `$derived` and server publish endpoint; resolves client/server divergence
2. `$lib/utils/token-cost.ts` (NEW) — cost estimation utilities; pure arithmetic, no DB access, usable on client and server
3. `$lib/components/builder/ValidationPanel.svelte` (NEW) — extracted from inline `+page.svelte` markup; receives `ValidationFinding[]`, renders list with jump-to-node callbacks
4. `$lib/components/builder/DataFlowEdge.svelte` (NEW) — custom `@xyflow/svelte` edge using `BaseEdge` + `EdgeLabel`; registered in `ChapterDAG.svelte` via `edgeTypes` constant defined at module level
5. `$lib/components/builder/AISkillPreview.svelte` (NEW) — stateless preview modal; receives proposed `{ chapters, edges }` from AI response; `onConfirm` / `onCancel` callbacks only; no API calls
6. `$lib/components/builder/SkillVersionHistory.svelte` (NEW) — version list panel; uses list endpoint (metadata only, no snapshot blobs)
7. `$server/services/builder-versions.service.ts` (NEW) — snapshot create/restore using `ctx.db.transaction()` wrapping full JSON blob writes
8. `$server/db/schema/builder.ts` (MODIFY) — add `built_skill_versions` table: `id, skillId FK, versionNumber, label, changelog, snapshotJson, createdAt`
9. `+page.svelte` (MODIFY) — wire new components; add `AbortController` cleanup via `$effect` return; disable publish on `validationCounts.errors > 0`

**Build order (dependency-aware):**
Steps 1-4 (extract `dag-validation.ts`, wire to server, fix publish button, extract `ValidationPanel`) must precede any other work. Steps 5-8 (AbortController, token-cost utils, cost API return, `CostBadge`) are independent and can be done in any order relative to each other. Steps 9-13 (staged AI import preview, batch-add-chapters N+1 fix, `DataFlowEdge`) come next. Steps 14-17 (versioning schema, service, API route, `SkillVersionHistory` UI) come last because they depend on nothing but have the highest atomicity requirements.

---

### Critical Pitfalls

1. **God-component collapse in `+page.svelte`** — The page is already ~600 lines with inline business logic. Every new feature adds state directly to the page, compounding technical debt exponentially. Prevention: extract all skill editor state to `src/lib/state/builder/skill-editor.svelte.ts` before adding any new features. This is the pattern every other domain in the codebase already follows (`reliability`, `workshop`, `config`).

2. **Client/server validation divergence** — The client's `$derived.by()` validation and `builder.service.ts` `validateSkillForPublish` already use different rules (client checks all chapters for tools; server discriminates by `type`). Adding more rules to both without a shared module guarantees drift. Prevention: `dag-validation.ts` in `$lib/utils/` exports pure functions; server calls them first, then adds DB-backed checks.

3. **Torn version snapshots from non-transactional writes** — The existing builder service has zero use of DB transactions; all inserts are standalone queries. Snapshot creation following this pattern produces partial snapshots on failure. Prevention: `ctx.db.transaction()` wraps the entire snapshot insert; store full denormalized JSON blob (not FK references to mutable tables).

4. **AbortController and saveTimer lifecycle leaks** — Adding AbortController without `$effect` cleanup causes state-on-destroyed-component warnings when navigating away mid-generation. The existing `saveTimer` (line 29 of the page) already leaks. Prevention: Svelte 5 `$effect(() => { return () => { /* abort all controllers */ }; })` pattern; fix both in the same phase.

5. **SvelteFlow `flowEdges` re-rendering on every chapter text keystroke** — If the custom edge derivation reads chapter `outputDef` or `guide` text fields, any keystroke in the chapter editor triggers: validation recompute → edge recompute → SvelteFlow full canvas diff. Prevention: derive edges only from the edge list; pass content as a separate `edgeMetadata` prop; define `edgeTypes` at module level (not inline in template).

---

## Implications for Roadmap

Based on the dependency graph in ARCHITECTURE.md and the pitfall-to-phase mapping in PITFALLS.md, the research strongly suggests 6 phases ordered by dependency and risk.

### Phase 1: State Architecture Refactor (Prerequisite)
**Rationale:** `+page.svelte` at ~600 lines is already fragile. PITFALLS.md identifies this as a prerequisite for every subsequent phase — adding validation UI, cost tracking, or versioning state directly to the page will make the extraction exponentially harder afterward. Every other domain in the codebase (`reliability`, `workshop`, `config`) already uses this pattern.
**Delivers:** `src/lib/state/builder/skill-editor.svelte.ts` owns chapters, edges, chapterToolMap, saving, dirty flag, validation findings. The page becomes a thin coordinator.
**Avoids:** God-component collapse (Pitfall 1), `$effect` cleanup gaps (Pitfall 4)
**Research flag:** Standard pattern — no additional research needed. The existing `src/lib/state/reliability/` module is the template.

### Phase 2: Validation UX
**Rationale:** Fixes actively broken UX (joined error string banner) with the lowest implementation complexity in the milestone. Builds the shared `dag-validation.ts` module that every subsequent phase depends on. The publish button gate is both table stakes and a prerequisite for safe versioning.
**Delivers:** Structured `ValidationFinding[]` from shared module; `ValidationPanel.svelte` with clickable errors; inline red badges on DAG nodes; publish button disabled on errors.
**Addresses:** All P1 validation features from FEATURES.md; jump-to-node navigation via `fitView`
**Uses:** Pure TypeScript in `$lib/utils/dag-validation.ts`; SvelteFlow `useReactFlow()` for viewport control
**Avoids:** Client/server validation divergence (Pitfall 2)
**Research flag:** Standard patterns. SvelteFlow viewport control API is well-documented.

### Phase 3: Error Handling Hardening
**Rationale:** Independent of other phases but should come early since AbortController patterns must be established before cost tracking and AI preview features add more fetch calls. Fixes the existing `saveTimer` leak simultaneously.
**Delivers:** `AbortSignal.timeout(30_000)` on all AI fetches; server-side 25s timeout on OpenRouter calls (returns 504); `$effect` cleanup for all controllers and the existing saveTimer leak.
**Avoids:** AbortController + saveTimer lifecycle leaks (Pitfall 4)
**Research flag:** Standard. AbortSignal.timeout() behavior verified in STACK.md (SvelteKit 2.53.3 is safe).

### Phase 4: Cost and Token Display
**Rationale:** Independent of validation and versioning. OpenRouter already returns `usage.cost` in the API response — the data is being discarded on every call today. This is pure extraction work with minimal risk. Cost display only (no DB persistence in Phase 1); persistence can be added if budget caps are desired later.
**Delivers:** `token-cost.ts` utility; `usage` returned from both AI API routes; `CostBadge.svelte` in toolbar showing `~$0.004 (1,247 tok)` with "estimated" qualifier.
**Addresses:** Token/cost display (P1 feature from FEATURES.md)
**Avoids:** Stale pricing data pitfall — display tokens prominently alongside estimates; use "~" prefix and tooltip disclaimer. Do not hardcode model prices without a fallback.
**Research flag:** Standard. OpenRouter usage object verified in STACK.md.

### Phase 5: Data Flow Edge Visualization + Staged AI Import
**Rationale:** These two features are grouped because both involve the AI generation data path and both require the SvelteFlow edge stability patterns to be understood before implementation. The staged import preview is a UI-only change (no schema) and can ship in the same phase as the custom edge type.
**Delivers:** `DataFlowEdge.svelte` custom edge with hover upstream output preview; `edgeTypes` registered at module level; `AISkillPreview.svelte` modal that holds AI response until user confirms; `batch-add-chapters` action on the PUT handler (fixes N+1 sequential writes).
**Addresses:** Edge label rendering (P1), staged import preview (P2) from FEATURES.md
**Avoids:** SvelteFlow edge re-render on keystroke (Pitfall 5); `edgeTypes` reference instability
**Research flag:** Verify `$derived.by()` with edge content in the actual @xyflow/svelte 1.5.1 build before implementation — PITFALLS.md notes MEDIUM confidence on this re-render behavior.

### Phase 6: Skill Versioning
**Rationale:** Comes last because it has the highest schema risk (new table, atomic transactions) and the most implementation steps (schema, service, API route, UI). It builds on the validation infrastructure (Phase 2) and benefits from the batch-insert pattern (Phase 5). The AI import preview (Phase 5) also auto-snapshots before applying AI changes, which requires version infrastructure to be in place.
**Delivers:** `built_skill_versions` table; `builder-versions.service.ts` with `ctx.db.transaction()` snapshot creation; `GET /versions` (metadata list only, no blobs); `POST /versions` (create named snapshot); `POST /versions/[id]/restore` (transactional restore); `SkillVersionHistory.svelte` panel.
**Addresses:** Version history (P2), named snapshots with changelog (P2), rollback (P2) from FEATURES.md
**Avoids:** Torn version snapshot from non-transactional writes (Pitfall 3); snapshot blob in list endpoint (Security section)
**Research flag:** Verify Drizzle `ctx.db.transaction()` signature for LibSQL dialect before implementation — PITFALLS.md notes MEDIUM confidence. Also verify `db:generate + db:migrate` workflow against the existing `drizzle.config.ts` for Turso production target.

---

### Phase Ordering Rationale

- **Phase 1 first:** Every other phase modifies `+page.svelte`. Doing state extraction last means six phases of compounding inline state additions instead of one upfront extraction that makes all subsequent changes safe.
- **Phase 2 before Phase 6:** The shared `dag-validation.ts` module is the foundation for publish-blocking in versioning (auto-validate before snapshot creation). Schema-first versioning without client validation is a UX trap.
- **Phase 3 early:** Establishes AbortController patterns and `$effect` cleanup discipline before Phases 4, 5, and 6 add more async operations.
- **Phase 4 independent:** Cost display is truly independent — it can be done in parallel with Phase 3 if resources allow.
- **Phase 5 before Phase 6:** The `batch-add-chapters` pattern (Phase 5) is reused by the version restore path. The staged import preview in Phase 5 also needs versioning infrastructure to auto-snapshot before AI apply — so Phase 6 can extend Phase 5's preview with an auto-snapshot hook.

---

### Research Flags

**Needs per-phase research before planning:**
- **Phase 5 (Data Flow Edge):** SvelteFlow `$derived` re-render behavior with content-dependent edge data is MEDIUM confidence in PITFALLS.md. Run a targeted test in the actual codebase before writing the implementation plan.
- **Phase 6 (Versioning):** Drizzle LibSQL `ctx.db.transaction()` API signature — verify against installed `drizzle-orm@0.45.1` docs. Also verify `drizzle.config.ts` dialect for Turso production before designing the migration workflow.

**Standard patterns — skip research-phase:**
- **Phase 1 (State Refactor):** Template is the existing `src/lib/state/reliability/` module. Mechanical extraction.
- **Phase 2 (Validation UX):** SvelteFlow viewport control (`fitView`, `setCenter`) is well-documented. Pure TypeScript extraction is straightforward.
- **Phase 3 (AbortController):** `AbortSignal.timeout()` verified in STACK.md. Svelte 5 `$effect` cleanup is core API.
- **Phase 4 (Cost Display):** OpenRouter `usage` object verified in STACK.md. Pure arithmetic in `token-cost.ts`.

---

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | All decisions verified against official docs or installed versions. Zero new packages. |
| Features | MEDIUM-HIGH | Competitor analysis cross-referenced across 8 sources. P1/P2 split is solid. P3 deferral rationale is sound. |
| Architecture | HIGH | Based on direct codebase inspection of all relevant files. Build order is dependency-verified. |
| Pitfalls | HIGH | Every pitfall grounded in actual codebase line numbers. Two items flagged MEDIUM (SvelteFlow re-render, Drizzle transaction API) and called out explicitly. |

**Overall confidence:** HIGH

### Gaps to Address

- **Drizzle `ctx.db.transaction()` for LibSQL dialect:** PITFALLS.md and ARCHITECTURE.md both flag this as MEDIUM confidence. Verify the exact API signature and transaction semantics in `drizzle-orm@0.45.1` with the `@libsql/client@0.17.0` driver before writing the versioning service. The gap does not block earlier phases.
- **SvelteFlow `$derived` re-render profiling:** The edge re-render pitfall (Pitfall 5) is based on known React Flow / SvelteFlow behavior with object identity, but the exact behavior in `@xyflow/svelte@1.5.1` with Svelte 5 runes needs a targeted dev-mode test. Add a `console.log` in the `flowEdges` derivation and type in a chapter text field to confirm (or rule out) the regression before Phase 5 implementation.
- **Cost display policy decision:** PITFALLS.md presents three options (token count only, cost with disclaimer, dynamic pricing from config). The roadmap assumes "cost with estimated disclaimer" but this is a product decision that should be confirmed before Phase 4 planning begins.
- **Staged AI import auto-snapshot coupling:** FEATURES.md notes that staged import "can snapshot before AI overwrites" — this requires Phase 6 (versioning) infrastructure to be in place. If Phase 5 ships before Phase 6, the auto-snapshot should be omitted from Phase 5 and added as an enhancement when Phase 6 completes.

---

## Sources

### Primary (HIGH confidence)
- [Svelte Flow Custom Edges docs](https://svelteflow.dev/learn/customization/custom-edges) — EdgeTypes API, BaseEdge, EdgeLabel
- [Svelte Flow EdgeLabel API](https://svelteflow.dev/api-reference/components/edge-label) — x/y props, nodrag/nopan classes
- [OpenRouter API reference](https://openrouter.ai/docs/api/reference/overview) — usage.cost, prompt_tokens, completion_tokens
- [SvelteKit issue #13874 + PR #13877](https://github.com/sveltejs/kit/issues/13874) — AbortSignal.timeout() fix confirmed landed in 2.21.1
- [Drizzle + Turso docs](https://orm.drizzle.team/docs/drizzle-with-turso) — push vs migrate workflow
- Direct codebase inspection — `+page.svelte`, `builder.service.ts`, `ChapterDAG.svelte`, `builder.ts` schema, all AI routes
- [Dify Version Control docs](https://legacy-docs.dify.ai/guides/management/version-control) — named versions, restore-to-draft, changelog
- [HighLevel Workflow Error Highlighting](https://help.gohighlevel.com/support/solutions/articles/155000004872-highlighting-resolving-errors-in-a-workflow) — error side panel, click-to-navigate, node badges

### Secondary (MEDIUM confidence)
- [Vellum cost tracking changelog](https://docs.vellum.ai/changelog/2025/2025-03) — per-execution cost column, subworkflow cost display
- [n8n Workflow History](https://docs.n8n.io/workflows/history/) — Save vs Publish distinction, enterprise gating
- [n8n validation issue #10074](https://github.com/n8n-io/n8n/issues/10074) — generic "Validation Failed" UX gap; NODE-1525 closed without fix
- @xyflow/svelte re-render behavior with object identity — known pattern from React Flow lineage; needs targeted test in current installed version

### Tertiary (LOW confidence — verify during implementation)
- Drizzle `ctx.db.transaction()` exact API for LibSQL dialect — flagged MEDIUM in PITFALLS.md, listed here as gap to verify
- `db:generate + db:migrate` behavior on Turso target with a new additive table — verify against existing project scripts before versioning phase

---
*Research completed: 2026-03-18*
*Ready for roadmap: yes*
