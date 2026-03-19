# Phase 5: State Architecture Refactor - Research

**Researched:** 2026-03-18
**Domain:** Svelte 5 runes state extraction — god-component to dedicated `.svelte.ts` module
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- All state variables and business functions move to the state module. `+page.svelte` keeps only template markup and lifecycle orchestration (`$effect` for init/cleanup, route param handling).
- Single `$state` object pattern, consistent with existing `builderState` in `builder.svelte.ts`. One `skillEditorState = $state({...})` containing all 22 state variables.
- Add `$derived` for validation — extract existing inline validation logic (validationFindings, validationCounts) as `$derived` in the module now. Phase 7 will replace internals with shared validation module.
- The page's `$effect` calls init and returns a cleanup function. Standard Svelte 5 pattern.
- Cleanup must clear the saveTimer and abort any in-flight requests.
- Fix saveTimer leak during extraction — the cleanup pattern is part of the new lifecycle design, natural place for it.
- Convert validation to `$derived` during extraction — sets up cleanly for Phase 7.

### Claude's Discretion
- Module file layout (new `skill-editor.svelte.ts` alongside or merge with `builder.svelte.ts`)
- Auto-save timer ownership (module vs page `$effect`)
- Modal state placement (module vs page) — decide based on what makes Phase 7 (validation UX) and Phase 8 (error handling) cleanest
- Init pattern (explicit function vs reactive) — pick most idiomatic Svelte 5 approach for SvelteKit page components
- Error handling scaffolding scope (try/catch shells now or leave for Phase 8)
- Testing scope — decide based on refactor risk
- Child component extraction scope — if they share state with the page (chapter data, tool map), consider moving that shared state to the module; Phases 9/10 will touch those components anyway
- SvelteFlow derivation placement — consider what makes Phase 10 (Data Flow Visualization) easiest

### Deferred Ideas (OUT OF SCOPE)
None — discussion stayed within phase scope.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| ARCH-01 | Skill editor state (chapters, edges, tools, dirty tracking, AI generation) is extracted from +page.svelte into a dedicated .svelte.ts state module | Full state inventory documented below; module shape designed to match existing `builderState` pattern |
| ARCH-02 | +page.svelte is reduced to template + lifecycle orchestration, delegating business logic to the state module | Page template analysis complete; lifecycle boundary pattern identified using Svelte 5 `$effect` cleanup returns |
</phase_requirements>

---

## Summary

The skill editor `+page.svelte` is 1,789 lines with 22 `$state` variables, 20+ functions, and inline business logic including DFS cycle detection and validation derivations. This phase extracts all of that to `src/lib/state/builder/skill-editor.svelte.ts`, following the exact pattern already established by `builder.svelte.ts`. The result is a page file that contains only: route param reading, a single `$effect` for init+cleanup, and markup that reads from the module.

The existing codebase makes the right pattern obvious. `builder.svelte.ts` uses one exported `$state` object plus exported async functions. The barrel `index.ts` re-exports them. The new module follows this identically. The page currently uses `onMount` for init with no cleanup — this is the known saveTimer leak. The fix is replacing `onMount` with a `$effect(() => { init(); return cleanup; })` pattern, which is idiomatic Svelte 5 and fixes the leak in the same motion.

The child components (ChapterEditor.svelte, ChapterDAG.svelte) receive data via props and fire callbacks — they do not reach into page state directly. This means the extraction boundary is clean: everything currently declared in `<script>` in the page moves to the module; the template stays. No child component needs to change in this phase.

**Primary recommendation:** Create `src/lib/state/builder/skill-editor.svelte.ts` with a single `skillEditorState = $state({...})` and exported functions matching the current page's function set. Replace `+page.svelte`'s `<script>` with init/cleanup wiring and let the template reference `skillEditorState.*` instead of local variables.

---

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Svelte 5 runes | `^5.0.0` | `$state`, `$derived`, `$effect` for reactive module state | Project-wide; all state modules use runes |
| SvelteKit | `^2.52.0` | `$app/state` for `page.params` | Required for route param access |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| Vitest | `^4.0.18` | Unit tests for extracted pure functions | Test state module functions that are pure (validateConditionText, validation $derived logic) |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Single `$state({...})` object | Individual exported `$state` vars | Single object matches `builderState` pattern, easier to pass to child components if needed |
| `$effect` cleanup in page | `onDestroy` in page | `$effect` cleanup return is the Svelte 5 idiomatic pattern; `onDestroy` is Svelte 4 legacy |

**Installation:** No new packages needed. All tooling is already installed.

---

## Architecture Patterns

### Recommended Project Structure
```
src/lib/state/builder/
├── builder.svelte.ts      # existing — skill listing state (unchanged)
├── skill-editor.svelte.ts # NEW — all editor state + functions
└── index.ts               # existing barrel — add skill-editor exports
```

### Pattern 1: Single-Object State Module (matches existing `builderState`)

**What:** Export one `$state({...})` object containing all state fields, plus exported async functions that mutate it. This is the exact shape of `builder.svelte.ts` lines 33-39.

**When to use:** Any Svelte 5 state module in this project.

**Example:**
```typescript
// src/lib/state/builder/skill-editor.svelte.ts
export interface ChapterEntry {
  id: string;
  type?: string;
  name: string;
  description: string;
  guide: string;
  context: string;
  outputDef: string;
  conditionText?: string;
  positionX: number;
  positionY: number;
}

export interface ValidationFinding {
  level: 'error' | 'warning' | 'ok';
  message: string;
}

export const skillEditorState = $state({
  // Core skill fields
  skillId: '',
  name: 'Untitled Skill',
  description: '',
  emoji: '📘',
  status: 'draft' as 'draft' | 'published',
  maxCycles: 3,

  // Load/save state
  loading: true,
  saving: false,
  dirty: false,

  // Data
  chapters: [] as ChapterEntry[],
  chapterEdges: [] as { id: string; sourceChapterId: string; targetChapterId: string; label: string | null }[],
  chapterToolMap: {} as Record<string, string[]>,
  gatewayTools: [] as ToolStatusEntry[],

  // AI state
  aiBuilding: false,
  aiBuildError: null as string | null,

  // Publish state
  publishing: false,
  publishError: null as string | null,

  // Modal/editing state — keep here for Phase 7/8 access
  editingChapter: null as ChapterEntry | null,
  editingChapterToolIds: [] as string[],
  editingCondition: null as ChapterEntry | null,
  conditionText: '',
  conditionName: '',
  chapterToDelete: null as ChapterEntry | null,
  showValidation: false,
});

// Internal timer — not reactive state, not exported
let _saveTimer: ReturnType<typeof setTimeout> | null = null;
```

**Source:** Direct pattern match from `src/lib/state/builder/builder.svelte.ts` lines 33-39.

### Pattern 2: `$derived` in Module Scope

**What:** Svelte 5 `$derived` works at module scope in `.svelte.ts` files. The validation derivations from the page's `$derived.by()` block move intact to the module.

**When to use:** Any computed value that depends on `skillEditorState` fields.

**Example:**
```typescript
// In skill-editor.svelte.ts — these move from page verbatim
export const poolToolIds = $derived(
  [...new Set(Object.values(skillEditorState.chapterToolMap).flat())]
);

export const allToolIds = $derived(
  skillEditorState.gatewayTools.map(t => t.id)
);

export const validationFindings: ValidationFinding[] = $derived.by(() => {
  // ... existing DFS cycle detection + completeness checks ...
  // references skillEditorState.chapters, skillEditorState.chapterEdges, etc.
});

export const validationCounts = $derived({
  errors: validationFindings.filter(f => f.level === 'error').length,
  warnings: validationFindings.filter(f => f.level === 'warning').length,
  ok: validationFindings.filter(f => f.level === 'ok').length,
});

export const worstLevel = $derived<'error' | 'warning' | 'ok'>(
  validationCounts.errors > 0 ? 'error' : validationCounts.warnings > 0 ? 'warning' : 'ok'
);

export const conditionValidation = $derived(
  validateConditionText(skillEditorState.conditionText)
);
```

**Source:** Svelte 5 runes work at module scope in `.svelte.ts` files — established pattern in this codebase (e.g., `src/lib/state/ui/theme.svelte.ts` uses module-scope `$derived`).

### Pattern 3: Init Function + `$effect` Cleanup in Page

**What:** The page calls an exported `initSkillEditor(skillId)` function from a `$effect`, and returns a cleanup function. This replaces the current `onMount` + no-cleanup pattern.

**When to use:** SvelteKit page components that need reactive init on param change and guaranteed cleanup on unmount.

**Example:**
```typescript
// skill-editor.svelte.ts — exported init and cleanup
export function initSkillEditor(skillId: string) {
  skillEditorState.skillId = skillId;
  loadSkill(skillId);
  loadGatewayTools();
}

export function cleanupSkillEditor() {
  if (_saveTimer) {
    clearTimeout(_saveTimer);
    _saveTimer = null;
  }
  // Reset state so stale data doesn't flash on next visit
  skillEditorState.loading = true;
  skillEditorState.dirty = false;
}
```

```svelte
<!-- +page.svelte — the ENTIRE script block becomes this -->
<script lang="ts">
  import { page } from '$app/state';
  import { skillEditorState, validationFindings, validationCounts, worstLevel,
           conditionValidation, poolToolIds, allToolIds,
           initSkillEditor, cleanupSkillEditor, scheduleSave,
           publishSkill, buildSkillWithAI, addChapter, addCondition,
           saveCondition, updateCondition, openConditionOrChapter,
           confirmRemoveChapter, executeDeleteChapter, openChapterEditor,
           saveChapterEdits, connectChapters, deleteEdge } from '$lib/state/builder/skill-editor.svelte';
  import { conn } from '$lib/state/gateway';
  // ... UI component imports ...

  const skillId = $derived(page.params.id);

  $effect(() => {
    const id = skillId;
    initSkillEditor(id);
    return () => cleanupSkillEditor();
  });

  // Reload tools when gateway reconnects
  $effect(() => {
    if (conn.connected) loadGatewayTools();
  });

  // Auto-save on field changes
  $effect(() => {
    void skillEditorState.name;
    void skillEditorState.description;
    void skillEditorState.emoji;
    if (!skillEditorState.loading) scheduleSave();
  });
</script>
```

**Source:** Svelte 5 `$effect` cleanup pattern — standard documented Svelte 5 behavior. Used in `src/lib/services/gateway.svelte.ts` for WebSocket cleanup.

### Pattern 4: Module-Owned Timer (Not Page-Owned)

**What:** The `saveTimer` moves into the module as a module-level `let` variable (not `$state` — timers don't need to be reactive). The module's `scheduleSave()` and `cleanupSkillEditor()` manage it.

**Why:** The saveTimer currently leaks because it's declared on line 29 of `+page.svelte` as `let saveTimer` but `onMount` returns nothing and there is no `onDestroy`. Moving it to the module and clearing it in `cleanupSkillEditor()` fixes the leak without adding page-level lifecycle complexity.

**Anti-pattern to avoid:** Making `saveTimer` a `$state` variable. A `ReturnType<typeof setTimeout>` doesn't need reactivity; wrapping it in `$state` adds overhead and creates unnecessary re-renders.

### Pattern 5: Modal State Placement Decision

**Recommendation (Claude's discretion area):** Move all modal state into `skillEditorState`. Rationale:

- Phase 7 (Validation UX) adds a structured validation panel with per-chapter error navigation — it needs `showValidation` state.
- Phase 8 (Error Handling) adds error display inside `ChapterEditor.svelte` — it needs `editingChapter` state accessible to both the modal and any error handling logic.
- Keeping modal state in the page would require prop-drilling or separate extraction in Phase 7/8 anyway.
- The existing `builder.svelte.ts` pattern is already "all state in one object" — consistency wins here.

**Anti-pattern:** Splitting state between `skillEditorState` (module) and page-local `$state` vars (page). This creates two sources of truth and makes Phase 7/8 harder.

### Anti-Patterns to Avoid

- **Partial extraction:** Moving only "business logic" state to the module and leaving modal state in the page. Creates a split-brain problem for Phase 7/8.
- **Making `saveTimer` reactive:** `let _saveTimer` (private, non-reactive) is correct. `$state` for a timer reference adds cost with no benefit.
- **Using `onMount` without cleanup:** Current bug. The `$effect(() => { ...; return cleanup })` pattern fixes it. Do not add `onDestroy` — that is Svelte 4 style.
- **Calling `$derived` inside functions:** `$derived` must be declared at module scope or component top-level, not inside async functions or event handlers.
- **Importing `$server/` paths from the state module:** The state module lives under `$lib/`, which has no server boundary restriction. But the module must NOT import from `$server/services/` or Drizzle. It only imports from `$lib/` (types, utils, gateway service).

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Reactive state at module scope | Custom pub/sub or EventEmitter | Svelte 5 `$state` and `$derived` at module scope in `.svelte.ts` | This is exactly what runes are designed for; hand-rolled reactivity fights the compiler |
| Timer cleanup tracking | Array of timers, WeakMap, etc. | Single `let _saveTimer` module variable, cleared in cleanup function | There is exactly one save timer; over-engineering it adds complexity without benefit |
| Lifecycle hooks in a `.svelte.ts` | `onMount`/`onDestroy` imports | `$effect` in the consuming `.svelte` component | `onMount`/`onDestroy` only work inside Svelte component context, not in `.svelte.ts` modules |

**Key insight:** Svelte 5 runes work at module scope in `.svelte.ts` files — this is the entire design of the pattern. Do not try to simulate it with stores, writable signals, or custom reactive primitives.

---

## Common Pitfalls

### Pitfall 1: `onMount`/`onDestroy` in `.svelte.ts` Module

**What goes wrong:** Trying to call `onMount` or `onDestroy` inside `skill-editor.svelte.ts` to handle the timer cleanup. These functions only work inside a Svelte component's `<script>` block.

**Why it happens:** Developers familiar with Svelte 4 try to bring lifecycle functions into extracted state modules.

**How to avoid:** The module exposes a `cleanupSkillEditor()` function. The page's `$effect` calls it in the cleanup return. The page owns the lifecycle hooks; the module owns the state and logic.

**Warning signs:** `Error: lifecycle_outside_component` in the console.

### Pitfall 2: saveTimer Leak Survives Extraction

**What goes wrong:** The timer moves to the module but `cleanupSkillEditor()` is never called, or the page's `$effect` doesn't return the cleanup function.

**Why it happens:** The `$effect` cleanup return is syntactically easy to forget. If `initSkillEditor(id)` is called directly without a return value in the `$effect`, no cleanup runs on unmount.

**How to avoid:** The `$effect` in the page MUST be:
```typescript
$effect(() => {
  const id = skillId;
  initSkillEditor(id);
  return () => cleanupSkillEditor(); // ← this line is mandatory
});
```

**Warning signs:** Navigate away from the skill editor while the save is pending, then navigate back — if the old save fires and overwrites the new skill's data, the timer leaked.

### Pitfall 3: Stale `skillId` in Closures After Navigation

**What goes wrong:** If `loadSkill` or other async functions capture `skillId` from the outer scope, and the user navigates to a different skill before the async operation completes, the response updates the wrong skill's state.

**Why it happens:** SvelteKit reuses the same page component instance for same-route navigation (e.g., `/builder/skills/abc` → `/builder/skills/xyz`). The `$effect` re-runs, but in-flight async operations from the previous `skillId` may still resolve.

**How to avoid:** The `cleanupSkillEditor()` must abort any in-flight requests. Since this phase is not adding AbortController yet (that is Phase 8 per REQUIREMENTS.md), the minimal fix is to reset state in `cleanupSkillEditor()` and ignore responses where `data.skillId !== skillEditorState.skillId`. Alternatively, pass `skillId` as a parameter to each async function and check it before committing state.

**Warning signs:** After navigating quickly between two skills, the second skill shows data from the first.

### Pitfall 4: `$derived` References Stale Closure Values

**What goes wrong:** The `validationFindings $derived.by()` block captures local variable references instead of reading from `skillEditorState.*`. After extraction, it silently reads stale data.

**Why it happens:** The existing derivation in the page uses local `let chapters` and `let chapterEdges` variables. When moved to the module, all references must be updated to `skillEditorState.chapters`, `skillEditorState.chapterEdges`, etc.

**How to avoid:** After extraction, search for any remaining bare references to local variable names (`chapters`, `chapterEdges`, `name`, `description`) inside the module's `$derived` blocks. All must use `skillEditorState.*`.

**Warning signs:** Validation panel shows stale results — e.g., shows "No chapters defined" after adding a chapter.

### Pitfall 5: Auto-Save `$effect` Runs on Initial Load

**What goes wrong:** The auto-save `$effect` that tracks `name`, `description`, `emoji` fires immediately on page load (before `loadSkill` has populated state), scheduling a save of the default placeholder values and overwriting the real data.

**Why it happens:** The existing page already guards against this with `if (!loading) scheduleSave()`. This guard must survive the extraction.

**How to avoid:** The auto-save `$effect` in the page must remain gated on `!skillEditorState.loading`. The module's `loadSkill()` sets `loading = false` after populating state, so the guard correctly suppresses early saves.

**Warning signs:** Skill name reverts to "Untitled Skill" on every page load.

---

## Code Examples

Verified patterns from codebase inspection:

### Module-Level `$state` Object (from `builder.svelte.ts` lines 33-39)
```typescript
// Source: src/lib/state/builder/builder.svelte.ts
export const builderState = $state({
  skills: [] as BuiltSkillSummary[],
  agents: [] as BuiltAgentSummary[],
  tools: [] as BuiltToolSummary[],
  loading: false,
  error: null as string | null,
});
```

### Barrel Index Export Pattern (from `src/lib/state/builder/index.ts`)
```typescript
// Source: src/lib/state/builder/index.ts (current)
export { builderState, loadBuiltSkills, ... } from './builder.svelte';

// After Phase 5, add:
export { skillEditorState, validationFindings, validationCounts, worstLevel,
         conditionValidation, poolToolIds, allToolIds,
         initSkillEditor, cleanupSkillEditor, loadSkill, loadGatewayTools,
         scheduleSave, saveSkill, publishSkill, buildSkillWithAI,
         addChapter, removeChapter, updateChapterPosition,
         connectChapters, deleteEdge, confirmRemoveChapter, executeDeleteChapter,
         openChapterEditor, saveChapterEdits,
         addCondition, saveCondition, updateCondition, openConditionOrChapter,
         validateConditionText } from './skill-editor.svelte';
```

### `$effect` Cleanup Pattern (Svelte 5 idiomatic)
```typescript
// In +page.svelte <script>
$effect(() => {
  const id = skillId; // capture current value
  initSkillEditor(id);
  return () => cleanupSkillEditor();
});
```

### ChapterDAG Props (unchanged — no child component changes needed)
```svelte
<!-- ChapterDAG receives same props as before, just sourced from skillEditorState -->
<ChapterDAG
  chapters={skillEditorState.chapters}
  edges={skillEditorState.chapterEdges}
  onChapterClick={openConditionOrChapter}
  onChapterPositionChange={updateChapterPosition}
  onAddChapter={addChapter}
  onAddCondition={addCondition}
  onDeleteChapter={(ch) => confirmRemoveChapter(ch)}
  onConnect={connectChapters}
  onDeleteEdge={deleteEdge}
/>
```

### ChapterEditor Props (unchanged — no child component changes needed)
```svelte
<!-- ChapterEditor receives same props, just sourced from skillEditorState -->
{#if skillEditorState.editingChapter}
  <ChapterEditor
    chapter={skillEditorState.editingChapter}
    availableToolIds={allToolIds}
    chapterToolIds={skillEditorState.editingChapterToolIds}
    skillName={skillEditorState.name}
    skillDescription={skillEditorState.description}
    onSave={saveChapterEdits}
    onClose={() => { skillEditorState.editingChapter = null; }}
  />
{/if}
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Svelte 4 `writable` stores | Svelte 5 `$state` at module scope in `.svelte.ts` | Svelte 5.0 release (this codebase already uses new approach) | Module-scope reactivity without store subscription overhead |
| `onMount` + `onDestroy` for lifecycle | `$effect(() => { ...; return cleanup; })` | Svelte 5.0 | Cleanup is co-located with init; no separate `onDestroy` calls |
| `get(store)` to read store value | Direct property access on `$state` object | Svelte 5.0 | No import of `get` from `svelte/store`; simpler reading |

**Deprecated/outdated:**
- `onDestroy`: Svelte 4 pattern. Not needed in this refactor — use `$effect` cleanup return.
- `writable`, `derived` from `svelte/store`: Svelte 4. The project CLAUDE.md explicitly says "No stores API — everything is runes-based."

---

## Open Questions

1. **SvelteFlow `flowNodes`/`flowEdges` derivation placement**
   - What we know: These `$derived` arrays currently live in `ChapterDAG.svelte` and depend only on the `chapters` and `edges` props. They do NOT read from `skillEditorState` directly.
   - What's unclear: Should they move to the module now, making the DAG a pure display component, or stay in ChapterDAG? Phase 10 (Data Flow Visualization) will enrich edge data with `outputDef` content — if derivation stays in ChapterDAG, Phase 10 can add it there; if it moves to the module, Phase 10 adds it there.
   - Recommendation: Leave `flowNodes`/`flowEdges` in `ChapterDAG.svelte` for this phase. ChapterDAG's derivation depends only on `chapters[]` and `edges[]` props, which are passed cleanly. Moving them to the module would require the module to depend on `@xyflow/svelte` types, coupling domain state to a UI library. Phase 10 can revisit.

2. **Error handling scaffolding (try/catch shells)**
   - What we know: Current functions have inconsistent try/catch — `loadSkill` and `saveSkill` have them, `addChapter`, `removeChapter`, `connectChapters`, `deleteEdge`, `updateCondition` do not.
   - What's unclear: Add empty try/catch shells now (CONTEXT.md marks this as Claude's discretion) or leave for Phase 8?
   - Recommendation: Add try/catch shells during extraction. The extraction is a mechanical operation and adding shells is low-risk. This prevents Phase 8 from being blocked by missing scaffolding. Keep catch blocks minimal: `console.error('[skill-editor] ...', e)` only, no state changes.

---

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 4.0.18 |
| Config file | `vitest.config.ts` (root) |
| Quick run command | `bun run vitest run src/lib/state/builder/` |
| Full suite command | `bun run test` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| ARCH-01 | `skillEditorState` object shape matches all 22 variables | unit | `bun run vitest run src/lib/state/builder/skill-editor.svelte.test.ts` | ❌ Wave 0 |
| ARCH-01 | `validateConditionText()` accepts valid binary questions, rejects non-binary | unit | same | ❌ Wave 0 |
| ARCH-01 | `scheduleSave()` sets `dirty = true` and debounces | unit | same | ❌ Wave 0 |
| ARCH-02 | Page script block contains no inline `$state` vars beyond imports | manual | N/A — grep check | N/A |

**Note on ARCH-02:** The "page is reduced to template + lifecycle" requirement is verified by code review, not by a unit test. A grep for `let.*= $state` in `+page.svelte` after the refactor should return zero results. This is a manual verification step.

### Sampling Rate
- **Per task commit:** `bun run vitest run src/lib/state/builder/`
- **Per wave merge:** `bun run test`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `src/lib/state/builder/skill-editor.svelte.test.ts` — unit tests for `validateConditionText`, `initSkillEditor`/`cleanupSkillEditor` state reset, and `scheduleSave` dirty-flag behavior. These are pure/synchronous functions that don't require DOM.
- [ ] Note: Vitest config already handles `$lib` and `$server` path aliases (confirmed in `vitest.config.ts`). No additional setup needed.

---

## Sources

### Primary (HIGH confidence)
- Direct codebase inspection: `src/routes/(app)/builder/skills/[id]/+page.svelte` — full 1,789-line source; all 22 state vars, 20+ functions, lifecycle patterns inventoried
- Direct codebase inspection: `src/lib/state/builder/builder.svelte.ts` — canonical pattern to replicate
- Direct codebase inspection: `src/lib/state/builder/index.ts` — barrel export pattern
- Direct codebase inspection: `src/lib/components/builder/ChapterDAG.svelte` — full props interface; confirmed no page-state coupling beyond props
- Direct codebase inspection: `src/lib/components/builder/ChapterEditor.svelte` — full props interface; confirmed self-contained modal
- Direct codebase inspection: `vitest.config.ts` — test framework, aliases, setup files
- `.planning/research/PITFALLS.md` — god-component risks, saveTimer leak confirmation, `$effect` cleanup patterns
- `.planning/research/ARCHITECTURE.md` — module placement recommendations, build order

### Secondary (MEDIUM confidence)
- `.planning/phases/05-builder-tab/05-CONTEXT.md` — user decisions on extraction scope and lifecycle pattern
- CLAUDE.md (minion_hub) — confirms "No stores API — everything is runes-based" project convention

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all tooling confirmed in package.json; no new dependencies needed
- Architecture: HIGH — pattern directly copied from existing `builder.svelte.ts`; no novel patterns introduced
- Pitfalls: HIGH — all pitfalls grounded in actual source code (line numbers verified); saveTimer leak confirmed at line 29

**Research date:** 2026-03-18
**Valid until:** 2026-06-18 (stable — Svelte 5 runes API is production-stable; this codebase is already fully on it)
