# Phase 7: Validation UX - Research

**Researched:** 2026-03-19
**Domain:** SvelteKit / Svelte 5 UI patterns — validation panel, shared validation module, disabled button tooltip, Zag.js toast integration
**Confidence:** HIGH

## Summary

Phase 7 replaces the current flat-list validation modal (lines 270-302 of +page.svelte) with an inline resizable sidebar panel, disables the publish button when errors exist, extracts a shared pure validation function used by both client and server, and replaces the publish-error banner with Zag.js toasts.

The project already has all infrastructure in place: Zag.js toast system (`toaster`, `toastSuccess`, `toastError` in `$lib/state/ui/toast.svelte.ts`), Zag.js Splitter component (`$lib/components/layout/Splitter.svelte`), existing `$derived` validation findings in the state module, and the current modal structure to remove. This phase is primarily a refactor + new component, not new library integration.

The key implementation challenge is the `ValidationFinding` type upgrade: the current type has no `chapterId`/`chapterName` fields, so the shared module introduces a richer type that enables per-chapter grouping and Fix button targeting. The server-side `validateSkillForPublish` must be refactored to use the same pure function — but it currently fetches data from DB, so the shared module receives plain data and the server fetches first, then passes to the pure function.

**Primary recommendation:** Build in four discrete units — (1) shared validation module + tests, (2) state module wiring, (3) ValidationPanel component, (4) page integration + modal cleanup.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Error Panel Design:**
- Per-chapter grouped layout: findings grouped under chapter name headers, with a separate "Skill" group at top for skill-level findings (no name, no description)
- Inline resizable sidebar panel on the right edge of the canvas area, with a drag handle for width adjustment. Reuse the existing Splitter component
- Fix button per chapter group — clicking opens that chapter's editor modal on top of the panel
- Panel stays open behind the chapter editor modal. Findings auto-refresh reactively ($derived) after the editor is closed
- Hide passing chapters — only show chapters with errors or warnings. Summary line at bottom: "N chapters passing"
- Header with counts at top ("Validation — 2 errors, 1 warning") with close button. Summary footer for passing count
- Auto-open on publish attempt with errors — panel opens automatically when user clicks Publish and errors exist
- Manual toggle also supported — toolbar Validation button toggles panel open/closed anytime, in addition to auto-open on publish
- Replaces the current validation modal entirely — remove the old showValidation modal overlay

**Publish Button Behavior:**
- Visually disabled with `disabled` attribute when validation errors exist — grayed out, cursor:not-allowed
- Dynamic tooltip on disabled button: "Fix N error(s) before publishing" — count updates reactively
- Warnings do NOT block publish — only errors disable the button
- Server-side errors (save failed, HTTP errors) shown via Zag.js toasts instead of the current red banner — auto-dismiss after 5 seconds
- Success toast shown after successful publish ("Skill published!")
- Remove the existing publish-error banner component and publishError state

**Warning-vs-Error Flow:**
- When publish is clicked with warnings but no errors: auto-open the validation panel with a "Publish Anyway" button in the panel footer (not a separate modal)
- When no errors AND no warnings: publish immediately, no confirmation. Show success toast
- When errors exist: publish button is disabled (no click handler fires)

**Error vs Warning Classification:**
- Errors (block publish): No chapters defined, Chapter missing instructions (guide), Condition missing conditionText, Chapter has no tools assigned
- Warnings (allow with confirm): Skill has no custom name, Skill has no description, Chapters without output definitions, Chapters not connected (no edges), Cycle detected (bounded by maxCycles)

**Shared Validation Module (VALID-04):**
- Location: `src/lib/utils/skill-validation.ts` with colocated `skill-validation.test.ts`
- Pure function: `validateSkill(input: SkillValidationInput) => ValidationFinding[]`
- Input shape: plain data object `{ name, description, chapters, edges, chapterToolMap }` — no DB or Svelte dependency
- Finding shape: `{ level: 'error' | 'warning', message: string, chapterId: string | null, chapterName: string | null }` — enables per-chapter grouping and Fix button targeting
- Only returns errors and warnings — no 'ok' level findings. Client counts passing chapters separately for the summary line
- Imported by `skill-editor.svelte.ts` (client $derived) and `builder.service.ts` (server publish gate)
- Server filters to errors-only for the publish gate decision

**Accessibility (A11Y-01):**
- Validation panel has `role="complementary"` with `aria-label="Skill validation"`
- All modals (delete confirmation, condition editor, chapter editor) use `role="dialog"` on the modal element (not backdrop) with `aria-labelledby` pointing to the modal title element

### Claude's Discretion
- Splitter resize implementation details (min/max width, persist width to localStorage)
- Toast position and styling (top-right vs bottom-right)
- Zag.js toast setup and integration pattern
- Exact animation/transition for panel open/close
- Whether to show a "Publish Anyway" button only when panel was auto-opened on publish vs always when warnings exist

### Deferred Ideas (OUT OF SCOPE)

None — discussion stayed within phase scope.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| VALID-01 | Publish button is disabled when validation errors exist, with tooltip explaining why | Confirmed: HTML `disabled` attribute + `title` attribute; `$derived` error count from shared module |
| VALID-02 | Publish errors display as a structured panel with per-chapter messages and "Fix" buttons | Finding shape with `chapterId` enables grouping; `openChapterEditor()` already exists in state module |
| VALID-03 | Client-side validation includes condition nodes missing conditionText and per-chapter tool assignment checks | Currently these are warnings; CONTEXT.md reclassifies them as errors. Shared module handles both |
| VALID-04 | A shared pure validation function in $lib/utils/ is used by both client-side $derived and server-side validateSkillForPublish | Server fetches data then passes plain object; pure function has no DB/Svelte imports |
| VALID-05 | When publish is clicked with warnings but no errors, the validation panel auto-opens with a "Publish Anyway" button | Panel footer shows "Publish Anyway" only when auto-opened with warnings; new `publishAnyway` state flag |
| A11Y-01 | Modal role="dialog" is on the modal element (not backdrop), with aria-labelledby on validation/condition/delete modals | Currently role="dialog" is on the overlay div (wrong). Must move to inner modal element. Each modal needs id on title element |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Svelte 5 runes | (project standard) | `$derived.by()` for validation findings, `$state` for panel open/close | Project convention — all state uses runes |
| `@zag-js/splitter` | ^1.35.3 | Resizable panel divider | Already installed, already used in `Splitter.svelte` |
| `@zag-js/toast` | ^1.35.3 | Success/error toasts to replace publish-error banner | Already installed, `toaster` store already set up in `toast.svelte.ts` |
| Vitest | ^4.0.18 | Unit tests for shared validation module | Project test runner, colocated `.test.ts` pattern already established |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `lucide-svelte` | (project standard) | Icons in validation panel (XCircle, AlertTriangle, CheckCircle2) | Already used throughout builder UI |
| CSS variables (`--color-error`, `--color-warning`, `--color-success`) | (project standard) | Theming validation panel rows | Established pattern in existing validation modal CSS |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Reuse `Splitter.svelte` | Build custom drag-resize | Splitter already handles localStorage persistence, min/max, collapse states — no custom solution needed |
| Zag.js toast (existing) | New toast library | Toast infra is already fully integrated and mounted in root layout |

**Installation:**

No new packages required. All dependencies already present in package.json.

## Architecture Patterns

### Recommended Project Structure

New files this phase creates:
```
src/lib/utils/
├── skill-validation.ts         # Pure validateSkill() function (VALID-04)
└── skill-validation.test.ts    # Vitest unit tests

src/lib/components/builder/
└── ValidationPanel.svelte       # New inline sidebar panel (VALID-02)
```

Modified files:
```
src/lib/state/builder/
└── skill-editor.svelte.ts      # Wire shared module, add panel state, update publishSkill()

src/routes/(app)/builder/skills/[id]/
└── +page.svelte                # Replace modal with panel, fix disabled button, fix aria

src/server/services/
└── builder.service.ts          # Refactor validateSkillForPublish() to use shared module
```

### Pattern 1: Shared Pure Validation Function

**What:** A pure TypeScript function with no imports from Svelte or the DB layer. Takes a plain data object, returns an array of findings. Both client (`$derived`) and server (after DB fetch) call it.

**When to use:** Any logic that must be consistent between client and server, and that can be expressed as a pure data transformation.

**Example:**
```typescript
// src/lib/utils/skill-validation.ts

export interface SkillValidationInput {
  name: string;
  description: string;
  chapters: Array<{
    id: string;
    name: string;
    type?: string;
    guide?: string;
    conditionText?: string;
    outputDef?: string;
  }>;
  edges: Array<{ sourceChapterId: string; targetChapterId: string }>;
  chapterToolMap: Record<string, string[]>;
}

export interface ValidationFinding {
  level: 'error' | 'warning';
  message: string;
  chapterId: string | null;   // null = skill-level finding
  chapterName: string | null; // null = skill-level finding
}

export function validateSkill(input: SkillValidationInput): ValidationFinding[] {
  const findings: ValidationFinding[] = [];

  // Skill-level warnings (chapterId: null)
  if (!input.name.trim() || input.name.trim() === 'Untitled Skill') {
    findings.push({ level: 'warning', message: 'Skill has no custom name', chapterId: null, chapterName: null });
  }
  if (!input.description.trim()) {
    findings.push({ level: 'warning', message: 'Skill has no description', chapterId: null, chapterName: null });
  }

  // Skill-level errors
  if (input.chapters.length === 0) {
    findings.push({ level: 'error', message: 'No chapters defined', chapterId: null, chapterName: null });
    return findings; // no chapter-level checks possible
  }

  // Per-chapter errors and warnings
  for (const ch of input.chapters) {
    if (ch.type === 'chapter' && !ch.guide?.trim()) {
      findings.push({ level: 'error', message: 'Missing instructions (guide text)', chapterId: ch.id, chapterName: ch.name });
    }
    if (ch.type === 'condition' && !ch.conditionText?.trim()) {
      findings.push({ level: 'error', message: 'Missing condition question', chapterId: ch.id, chapterName: ch.name });
    }
    if (ch.type === 'chapter' && !(input.chapterToolMap[ch.id]?.length)) {
      findings.push({ level: 'error', message: 'No tools assigned', chapterId: ch.id, chapterName: ch.name });
    }
    if (!ch.outputDef?.trim()) {
      findings.push({ level: 'warning', message: 'No output definition', chapterId: ch.id, chapterName: ch.name });
    }
  }

  // Connectivity warnings (skill-level)
  if (input.chapters.length > 1 && input.edges.length === 0) {
    findings.push({ level: 'warning', message: 'Chapters not connected (no edges)', chapterId: null, chapterName: null });
  }

  // Cycle detection — warning (bounded by maxCycles), not error
  // (cycle logic omitted here for brevity — same DFS as existing code)

  return findings;
}
```

**Server usage after refactor:**
```typescript
// builder.service.ts — validateSkillForPublish
import { validateSkill } from '$lib/utils/skill-validation';

export async function validateSkillForPublish(ctx, skillId): Promise<ValidationResult> {
  const skill = await getBuiltSkill(ctx, skillId);
  const chapters = await getChapters(ctx, skillId);
  const edges = await getChapterEdges(ctx, skillId);
  // build chapterToolMap from DB batch query...

  const findings = validateSkill({ name: skill.name, description: skill.description ?? '', chapters, edges, chapterToolMap });
  const errors = findings.filter(f => f.level === 'error').map(f => f.message);
  return { valid: errors.length === 0, errors };
}
```

### Pattern 2: Validation Panel as Right-Side Splitter Panel

**What:** The ValidationPanel is placed on the RIGHT side of the DAG canvas. The Splitter component puts the DAG canvas as the LEFT panel and the validation panel as the RIGHT panel. This is inverted from the usual sidebar-left layout.

**Important:** The existing `Splitter.svelte` puts its `panel` slot on the LEFT and `children` on the RIGHT. For a right-side validation panel, we have two options:
1. Put the DAG canvas in the `panel` slot (left) and the validation panel in `children` (right) — but Splitter's collapse/expand controls are left-oriented.
2. Use a simpler `{#if showValidation}` conditional + CSS to show a fixed-width right panel, without using the Splitter at all.

**Recommendation:** Given that the panel should be toggleable (not always present), use a CSS-only resizable approach with a right-side panel div and the `Splitter` wrapping DAG+validation. The `book-page-right.dag-page` section in +page.svelte becomes a flex container holding `ChapterDAG` and `ValidationPanel` side-by-side, with the `ValidationPanel` having a fixed or resizable width.

The simplest approach matching the design intent: use the existing Splitter with `panel=ValidationPanel` (right) and `children=ChapterDAG` (left). This requires swapping the slot order. OR: use a plain div-based right panel with `resize: horizontal` or a manual drag handle — simpler than reversing the Splitter orientation.

**Decision for planner (discretion):** Either approach works. Recommend a simple inline approach: the DAG right page becomes `display: flex; flex-direction: row` with ChapterDAG taking `flex: 1` and ValidationPanel having a fixed right width (e.g. 280px) shown conditionally with CSS transition. Width persists to localStorage manually.

### Pattern 3: Disabled Button with Tooltip

**What:** HTML `disabled` attribute prevents click events. The `title` attribute shows a browser tooltip. In this project, `title` is used throughout the toolbar (existing pattern: see the save indicator's `title` prop).

```svelte
<button
  type="button"
  class="toolbar-btn {skillEditorState.status === 'published' ? 'published' : 'primary'}"
  onclick={handlePublishClick}
  disabled={skillEditorDerived.validationCounts.errors > 0 || skillEditorState.publishing}
  title={skillEditorDerived.validationCounts.errors > 0
    ? `Fix ${skillEditorDerived.validationCounts.errors} error${skillEditorDerived.validationCounts.errors !== 1 ? 's' : ''} before publishing`
    : skillEditorState.status === 'published' ? 'Republish with latest changes' : 'Publish to shared space'}
>
```

Note: `cursor: not-allowed` on a `disabled` button requires CSS since disabled buttons don't fire pointer events. Use `:disabled { cursor: not-allowed; opacity: 0.6; }`.

### Pattern 4: Toast Integration (Already Set Up)

**What:** The project has a fully operational Zag.js toast system. `toastSuccess`, `toastError` etc. are importable from `$lib/state/ui/toast.svelte`. Toaster is mounted in the root layout. No setup needed.

```typescript
// In publishSkill() — replace publishError state with toasts
import { toastSuccess, toastError } from '$lib/state/ui/toast.svelte';

// On success:
skillEditorState.status = 'published';
toastSuccess('Skill published!');

// On HTTP/network error:
toastError('Publish failed', e instanceof Error ? e.message : 'Unknown error');
```

The `toastError` already uses `duration: 8000` (8 seconds) by default. The CONTEXT.md says 5 seconds for server errors — override with `overrides: { duration: 5000 }`.

### Pattern 5: Accessibility Fix (A11Y-01)

**What:** Currently all overlays put `role="dialog"` on the backdrop div, not the inner modal. The fix is to move `role="dialog"` to the inner modal element and add `aria-labelledby` referencing the title element's `id`.

**Current (wrong):**
```svelte
<div class="confirm-overlay" role="dialog" aria-modal="true" ...>
  <div class="confirm-modal">
    <p class="confirm-title">...</p>
```

**Correct:**
```svelte
<div class="confirm-overlay" onclick={...} onkeydown={...}>
  <div class="confirm-modal" role="dialog" aria-modal="true" aria-labelledby="delete-modal-title">
    <p class="confirm-title" id="delete-modal-title">...</p>
```

Three modals need this fix: delete confirmation, condition editor, chapter editor (ChapterEditor.svelte). The new ValidationPanel uses `role="complementary"` (not dialog — it's a non-modal sidebar).

### Pattern 6: Panel Open State — publishAttemptedWithWarnings Flag

**What:** "Publish Anyway" only appears in the panel footer when: the user clicked Publish, there were warnings but no errors, and the panel auto-opened. A boolean flag in state tracks this.

```typescript
// In skillEditorState:
showValidation: false,
publishAnyway: false,   // true = show "Publish Anyway" in panel footer

// In publishSkill() before the fetch:
function handlePublishClick() {
  if (skillEditorDerived.validationCounts.errors > 0) return; // button is disabled, unreachable
  if (skillEditorDerived.validationCounts.warnings > 0) {
    skillEditorState.showValidation = true;
    skillEditorState.publishAnyway = true;
    return; // don't publish yet
  }
  publishSkill();
}

// "Publish Anyway" button calls publishSkill() directly
// After publish (success or fail), reset publishAnyway = false
```

### Anti-Patterns to Avoid

- **Putting validation logic in the component:** All validation logic lives in `skill-validation.ts`, not in `ValidationPanel.svelte`. The component only renders findings it receives.
- **Multiple sources of truth:** The `_validationFindings` derived in `skill-editor.svelte.ts` must be the ONLY source. The panel reads from `skillEditorDerived.validationFindings`.
- **Inline `role="dialog"` on backdrop:** Move to inner element (A11Y-01 fix).
- **Building a custom resize handle:** Reuse existing Splitter or use simpler CSS approach — don't hand-roll drag tracking.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Toast notifications | Custom toast state + DOM insertion | `toastSuccess()`/`toastError()` from `$lib/state/ui/toast.svelte` | Already wired in root layout with Zag.js |
| Resizable panel | Manual `mousemove` drag listener | Existing `Splitter.svelte` (Zag.js splitter) | Handles localStorage, snap, collapse, min/max |
| Validation logic duplication | Server-only or client-only copies | `validateSkill()` in `$lib/utils/skill-validation.ts` | One source of truth, testable in isolation |

**Key insight:** All infrastructure (toast, splitter, state module pattern) is in place. This phase is wiring and refactoring, not new library adoption.

## Common Pitfalls

### Pitfall 1: ValidationFinding Type Change Breaking Existing References

**What goes wrong:** The existing `ValidationFinding` type in `skill-editor.svelte.ts` has `level: 'error' | 'warning' | 'ok'` and no `chapterId`/`chapterName`. Changing it to the new shape from `skill-validation.ts` will break the current `_validationFindings` derived and any component that reads `validationFindings`.

**Why it happens:** The type is defined locally and used in the template (`finding.level`, `finding.message`). Adding fields is safe; removing `'ok'` level requires updating the template.

**How to avoid:** Define the canonical `ValidationFinding` in `skill-validation.ts` and import it into `skill-editor.svelte.ts` (replacing the local definition). Update the `_validationFindings` derived to no longer return `'ok'` level findings — the summary count replaces 'ok' items. The validation button tooltip and validation panel need updating to compute passing count from `chapters.length - chaptersWithFindings.length`.

**Warning signs:** TypeScript errors on `finding.level === 'ok'` after the type change.

### Pitfall 2: Splitter Orientation — Panel Is LEFT by Default

**What goes wrong:** `Splitter.svelte` always puts the `panel` slot on the LEFT and `children` on the RIGHT. Using it naively for a right-side validation panel will put the panel on the left.

**Why it happens:** The Splitter machine is configured with `panels: [{ id: 'panel' }, { id: 'content' }]` where `panel` is index 0 (left).

**How to avoid:** Either (a) put ChapterDAG in `panel` (left) and ValidationPanel in `children` (right) — this works but means "content" (DAG) is collapsible, not the panel; or (b) use a simpler CSS right-side panel with `{#if showValidation}` and manual width. Given the toggle behavior required (panel hides when closed), option (b) is more direct. Splitter is better suited for always-visible panels.

**Recommendation:** Use a flex container in the `book-page-right.dag-page` section. When `showValidation` is true, render both ChapterDAG and ValidationPanel side by side. No Splitter needed unless persistent resize is critical — a fixed 280px width is sufficient.

### Pitfall 3: publishError State Removal — cleanupSkillEditor Still References It

**What goes wrong:** `cleanupSkillEditor()` sets `skillEditorState.publishError = null`. After removing `publishError` from state, this line will TypeScript-error.

**Why it happens:** Cleanup function touches all state fields.

**How to avoid:** When removing `publishError` from the state object, grep for all references (`publishError`) and remove them all at once. There are references in: state object definition, `publishSkill()`, `cleanupSkillEditor()`, and the template's `{#if skillEditorState.publishError}` banner.

### Pitfall 4: Chapter Tool Errors — Current Code Classifies as Warnings

**What goes wrong:** The existing `_validationFindings` in `skill-editor.svelte.ts` classifies "chapters without tools" as `'warning'` (line 101). The CONTEXT.md classifies it as an `error`. If the shared module correctly classifies it as `error` but the old findings still run somewhere, the publish button disable logic could be wrong.

**Why it happens:** The migration is partial — old findings replaced by new module but one path missed.

**How to avoid:** The `_validationFindings` derived must be fully replaced by calling `validateSkill()` with state data. No parallel validation paths should remain.

### Pitfall 5: "Publish Anyway" Persisting Across Navigation

**What goes wrong:** If `publishAnyway = true` is set but the user navigates away and back, the flag could persist and show the button unexpectedly.

**Why it happens:** State module is module-scoped and survives navigation unless `cleanupSkillEditor()` resets it.

**How to avoid:** Add `skillEditorState.publishAnyway = false` to `cleanupSkillEditor()`.

## Code Examples

Verified patterns from existing codebase:

### Toast Call Pattern (from existing toast.svelte.ts)
```typescript
// Import from existing module — no new setup needed
import { toastSuccess, toastError } from '$lib/state/ui/toast.svelte';

toastSuccess('Skill published!');
toastError('Publish failed', 'Could not save. Please try again.', { duration: 5000 });
```

### Existing $derived Pattern (from skill-editor.svelte.ts lines 161-165)
```typescript
const _validationCounts = $derived({
  errors: _validationFindings.filter(f => f.level === 'error').length,
  warnings: _validationFindings.filter(f => f.level === 'warning').length,
});
```

### Disabled Button CSS Pattern (from existing toolbar styles)
```css
/* Add to existing toolbar-btn styles */
.toolbar-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
```

### Colocated Test Pattern (from format.test.ts)
```typescript
import { describe, it, expect } from 'vitest';
import { validateSkill } from './skill-validation';

describe('validateSkill', () => {
  it('returns error when no chapters', () => {
    const result = validateSkill({ name: 'Test', description: '', chapters: [], edges: [], chapterToolMap: {} });
    expect(result).toContainEqual(expect.objectContaining({ level: 'error', chapterId: null }));
  });
  it('returns error for chapter missing guide', () => {
    const ch = { id: 'c1', name: 'Step 1', type: 'chapter', guide: '', conditionText: '', outputDef: '' };
    const result = validateSkill({ name: 'Test', description: 'x', chapters: [ch], edges: [], chapterToolMap: { c1: ['tool-1'] } });
    expect(result).toContainEqual(expect.objectContaining({ level: 'error', chapterId: 'c1' }));
  });
});
```

### ValidationPanel Grouping Logic
```typescript
// Group findings by chapterId for the panel
const skillFindings = findings.filter(f => f.chapterId === null);
const chapterFindings = new Map<string, ValidationFinding[]>();
for (const f of findings.filter(f => f.chapterId !== null)) {
  const group = chapterFindings.get(f.chapterId!) ?? [];
  group.push(f);
  chapterFindings.set(f.chapterId!, group);
}
```

### A11Y Modal Fix Pattern
```svelte
<!-- Backdrop: no role, handles click-outside and ESC -->
<div
  class="confirm-overlay"
  onclick={(e) => { if (e.target === e.currentTarget) skillEditorState.chapterToDelete = null; }}
  onkeydown={(e) => { if (e.key === 'Escape') skillEditorState.chapterToDelete = null; }}
>
  <!-- Modal: role="dialog" here, NOT on backdrop -->
  <div
    class="confirm-modal"
    role="dialog"
    aria-modal="true"
    aria-labelledby="delete-modal-title"
  >
    <p class="confirm-title" id="delete-modal-title">Delete "{skillEditorState.chapterToDelete?.name}"?</p>
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Modal overlay for validation | Inline sidebar panel | Phase 7 | Panel stays open during chapter editing; reactively updates |
| All findings flat list with 'ok' level | Only errors/warnings returned; passing count computed separately | Phase 7 | Cleaner panel rendering; simpler grouping |
| Validation logic inlined in $derived | Pure function in $lib/utils/ | Phase 7 | Testable, server-side reuse |
| publishError state + banner | Zag.js toasts | Phase 7 | Consistent notification UX, auto-dismiss |

**Deprecated/outdated after this phase:**
- `ValidationFinding.level === 'ok'`: removed from the type — no 'ok' findings returned
- `skillEditorState.publishError`: removed from state object
- `skillEditorState.showValidation` as modal flag: repurposed to control panel open/closed
- The `publish-error` CSS class and associated styles: deleted from +page.svelte

## Open Questions

1. **Splitter vs CSS panel for validation sidebar**
   - What we know: Splitter.svelte is left-panel-oriented; the validation panel is on the right
   - What's unclear: Whether the user expects drag-to-resize or a fixed width is sufficient
   - Recommendation: Start with fixed 280px CSS panel (simpler, no orientation mismatch). If resize is needed, wrap DAG+panel in a reversed Splitter (content=DAG in left slot, panel=Validation in right — requires Splitter to accept a right-panel layout, which it currently doesn't natively). The discretion note in CONTEXT.md covers this.

2. **ChapterEditor.svelte aria fix scope**
   - What we know: A11Y-01 requires `role="dialog"` on the modal element in all modals
   - What's unclear: Whether `ChapterEditor.svelte` already has a correct `role="dialog"` placement
   - Recommendation: Read ChapterEditor.svelte during planning to confirm its current aria structure before writing the plan task.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest ^4.0.18 |
| Config file | vite.config.ts (via SvelteKit plugin — no separate vitest config) |
| Quick run command | `bun run vitest run src/lib/utils/skill-validation.test.ts` |
| Full suite command | `bun run test` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| VALID-04 | `validateSkill()` returns error for no chapters | unit | `bun run vitest run src/lib/utils/skill-validation.test.ts` | ❌ Wave 0 |
| VALID-04 | `validateSkill()` returns error for chapter missing guide | unit | `bun run vitest run src/lib/utils/skill-validation.test.ts` | ❌ Wave 0 |
| VALID-04 | `validateSkill()` returns error for chapter missing tools | unit | `bun run vitest run src/lib/utils/skill-validation.test.ts` | ❌ Wave 0 |
| VALID-04 | `validateSkill()` returns error for condition missing conditionText | unit | `bun run vitest run src/lib/utils/skill-validation.test.ts` | ❌ Wave 0 |
| VALID-04 | `validateSkill()` returns warning for no skill name | unit | `bun run vitest run src/lib/utils/skill-validation.test.ts` | ❌ Wave 0 |
| VALID-04 | `validateSkill()` returns warning for no description | unit | `bun run vitest run src/lib/utils/skill-validation.test.ts` | ❌ Wave 0 |
| VALID-04 | `validateSkill()` returns warning for no output def | unit | `bun run vitest run src/lib/utils/skill-validation.test.ts` | ❌ Wave 0 |
| VALID-04 | `validateSkill()` returns warning for disconnected chapters | unit | `bun run vitest run src/lib/utils/skill-validation.test.ts` | ❌ Wave 0 |
| VALID-01, 02, 03, 05 | Publish button disable, panel render, warn flow | manual-only | N/A | N/A — Svelte component UI |
| A11Y-01 | role="dialog" on modal element | manual-only | N/A | N/A — requires browser ARIA inspection |

**Manual-only justification:** VALID-01/02/03/05 and A11Y-01 require DOM interaction and Svelte reactivity that cannot be unit-tested without a browser runtime. These are verified by running the dev server and inspecting behavior.

### Sampling Rate
- **Per task commit:** `bun run vitest run src/lib/utils/skill-validation.test.ts`
- **Per wave merge:** `bun run test`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `src/lib/utils/skill-validation.test.ts` — covers VALID-04 (all validation rules)

## Sources

### Primary (HIGH confidence)
- Direct code inspection: `src/lib/state/builder/skill-editor.svelte.ts` — existing types, derived values, state shape
- Direct code inspection: `src/routes/(app)/builder/skills/[id]/+page.svelte` — existing modal (lines 270-302), toolbar (lines 91-119), banner (lines 123-129)
- Direct code inspection: `src/server/services/builder.service.ts` — `validateSkillForPublish()` lines 81-161
- Direct code inspection: `src/lib/components/layout/Splitter.svelte` — Zag.js splitter integration, props API
- Direct code inspection: `src/lib/state/ui/toast.svelte.ts` — `toaster`, `toastSuccess`, `toastError` already available
- Direct code inspection: `src/lib/components/layout/Toaster.svelte` — mounted in root layout, position top-right
- Direct code inspection: `package.json` — `@zag-js/toast@^1.35.3`, `@zag-js/splitter@^1.35.3`, `vitest@^4.0.18` all present
- Direct code inspection: `src/lib/utils/format.test.ts` — colocated test pattern with vitest

### Secondary (MEDIUM confidence)
- CONTEXT.md decisions — detailed implementation decisions from /gsd:discuss-phase session

### Tertiary (LOW confidence)
- None

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all packages verified present in package.json, API confirmed via source reading
- Architecture: HIGH — all integration points confirmed by reading existing source files
- Pitfalls: HIGH — identified by cross-referencing existing types with CONTEXT.md requirements (type change scope, orientation mismatch)
- Test patterns: HIGH — confirmed by reading existing test files and vitest setup

**Research date:** 2026-03-19
**Valid until:** 2026-06-19 (stable Svelte 5 + Zag.js patterns)
