# Phase 5: State Architecture Refactor - Context

**Gathered:** 2026-03-18
**Status:** Ready for planning

<domain>
## Phase Boundary

Extract the skill editor's business logic and state from `+page.svelte` (1,789 lines, 22 `$state` vars, 20+ functions) into a dedicated `.svelte.ts` state module. The page becomes template + lifecycle only. This is a prerequisite for all subsequent phases (6-13) which add features to the editor.

</domain>

<decisions>
## Implementation Decisions

### Module Boundary
- **All state variables and business functions move** to the state module — +page.svelte keeps only template markup and lifecycle orchestration ($effect for init/cleanup, route param handling)
- Modal/dialog state (editingChapter, editingCondition, chapterToDelete, showValidation) — **Claude's discretion** on whether to move or keep, based on what makes Phase 7 (validation UX) and Phase 8 (error handling) cleanest
- The page should be reduced to: route params → init state module → template renders from module state → $effect cleanup on unmount

### State Shape
- **Single `$state` object** pattern, consistent with existing `builderState` in `builder.svelte.ts`
- One `skillEditorState = $state({...})` containing all 22 state variables
- **Add `$derived` for validation** — extract existing inline validation logic (validationFindings, validationCounts) as `$derived` in the module now. Phase 7 will replace internals with shared validation module.
- File layout, auto-save placement — **Claude's discretion** (new file alongside `builder.svelte.ts` vs merged, auto-save as module-owned timer vs page $effect)

### Init & Lifecycle
- Initialization pattern — **Claude's discretion** (init function vs reactive parameter), pick the most idiomatic Svelte 5 approach for SvelteKit page components
- **Cleanup via `$effect` return** in the page — the page's $effect calls init and returns a cleanup function. Standard Svelte 5 pattern.
- Cleanup must clear the saveTimer and abort any in-flight requests

### Scope of Fix-While-Moving
- **Fix saveTimer leak during extraction** — the cleanup pattern is part of the new lifecycle design, natural place for it
- **Convert validation to `$derived`** during extraction — sets up cleanly for Phase 7
- Error handling scaffolding on mutations — **Claude's discretion** on whether to add try/catch shells now or leave for Phase 8

### Testing
- **Claude's discretion** — decide based on refactor risk. Options: unit tests for module functions, smoke test for state shape, or defer to subsequent phases.

### Child Components
- **Claude's discretion** on whether to touch ChapterEditor.svelte and ChapterDAG.svelte during extraction. If they share state with the page (chapter data, tool map), consider moving that shared state to the module. Phases 9/10 will touch those components anyway.

### SvelteFlow Integration
- **Claude's discretion** on whether DAG canvas derivation (flowNodes, flowEdges from chapters/edges) lives in ChapterDAG.svelte or the state module. Consider what makes Phase 10 (Data Flow Visualization) easiest.

### Claude's Discretion
- Module file layout (new `skill-editor.svelte.ts` alongside or merge with `builder.svelte.ts`)
- Auto-save timer ownership (module vs page $effect)
- Modal state placement (module vs page)
- Init pattern (explicit function vs reactive)
- Error handling scaffolding scope
- Testing scope
- Child component extraction scope
- SvelteFlow derivation placement

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Skill Editor (extraction source)
- `src/routes/(app)/builder/skills/[id]/+page.svelte` — The 1,789-line god-component being refactored. Read fully to understand all state, functions, and template structure.

### Existing State Patterns
- `src/lib/state/builder/builder.svelte.ts` — Current builder listing state module. Follow its pattern (single $state object, exported async functions).
- `src/lib/state/builder/index.ts` — Barrel export pattern for the builder state directory.

### Child Components
- `src/lib/components/builder/ChapterEditor.svelte` — Chapter editor modal. Check what props it receives from the page.
- `src/lib/components/builder/ChapterDAG.svelte` — DAG canvas. Check SvelteFlow node/edge derivation and props from page.

### Research
- `.planning/research/PITFALLS.md` — God-component risks, saveTimer leak, validation divergence
- `.planning/research/ARCHITECTURE.md` — Integration points, module placement recommendations
- `.planning/research/SUMMARY.md` — Build order and prerequisites

### Blueprint
- `~/Documents/VAULT/MINION/OpenClaw Skill Builder — UI Implementation Blueprint.md` — Full improvement strategy, Phases 1-8

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `builder.svelte.ts`: Established `$state` object + exported async functions pattern. Follow this for the editor module.
- `index.ts` barrel in `src/lib/state/builder/`: Already exists, just needs to re-export the new module.

### Established Patterns
- **State modules**: `$state` runes in `.svelte.ts` files, exported state object + functions, barrel `index.ts` for clean imports
- **Service calls**: `fetch('/api/builder/...')` with JSON body, error handling varies (some try/catch, some none)
- **Dirty tracking**: Manual `dirty = true` flag set in mutation functions, checked before navigation

### Integration Points
- `+page.svelte` consumes route params via `$page.params.id`
- ChapterEditor receives chapter data, tool map, and gateway tools as props
- ChapterDAG receives chapters, edges, and callbacks for CRUD operations as props
- Auto-save uses `setTimeout` with `scheduleSave()` calling `saveSkill()`
- Gateway tools loaded via separate `sendRequest('tools.status')` call

### Current State Variables (22 total)
- Core: name, description, emoji, maxCycles, loading, saving, dirty
- Chapters: chapters[], chapterEdges[], chapterToolMap{}
- Editing: editingChapter, editingChapterToolIds, editingCondition, conditionText, conditionName
- Publishing: publishing, publishError
- AI: aiBuilding, aiBuildError
- UI: chapterToDelete, showValidation
- External: gatewayTools[]

### Current Functions (20+ total)
- Load: loadGatewayTools(), loadSkill()
- Save: scheduleSave(), saveSkill()
- Publish: publishSkill()
- AI: buildSkillWithAI()
- Condition: validateConditionText(), addCondition(), saveCondition(), updateCondition()
- Chapter: addChapter(), removeChapter(), updateChapterPosition(), confirmRemoveChapter(), executeDeleteChapter(), openChapterEditor(), saveChapterEdits()
- Edge: connectChapters(), deleteEdge()
- Navigation: openConditionOrChapter()
- Validation: inline dfs() for cycle detection

</code_context>

<specifics>
## Specific Ideas

- The existing `builderState` in `builder.svelte.ts` handles listing. The new `skillEditorState` handles the editor. Two separate concerns, one directory.
- Research found the page is at 1,789 lines — bigger than the 600-line estimate. Even more reason to extract aggressively.
- The saveTimer leak is confirmed: `let saveTimer: ReturnType<typeof setTimeout>` at line 29, set in `scheduleSave()`, never cleared on page unmount.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 05-state-architecture-refactor*
*Context gathered: 2026-03-18*
