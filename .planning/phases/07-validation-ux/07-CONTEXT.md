# Phase 7: Validation UX - Context

**Gathered:** 2026-03-19
**Status:** Ready for planning

<domain>
## Phase Boundary

Skill authors see exactly which chapters have errors, why publish is blocked, and can navigate directly to any broken chapter from the error panel. Replaces the current flat-list validation modal with a structured inline sidebar panel, disables the publish button when errors exist, and extracts a shared pure validation function used by both client and server.

</domain>

<decisions>
## Implementation Decisions

### Error Panel Design
- **Per-chapter grouped** layout: findings grouped under chapter name headers, with a separate "Skill" group at top for skill-level findings (no name, no description)
- **Inline resizable sidebar panel** on the right edge of the canvas area, with a drag handle for width adjustment. Reuse the existing Splitter component
- **Fix button** per chapter group — clicking opens that chapter's editor modal on top of the panel
- Panel **stays open behind the chapter editor modal**. Findings auto-refresh reactively ($derived) after the editor is closed
- **Hide passing chapters** — only show chapters with errors or warnings. Summary line at bottom: "N chapters passing"
- **Header with counts** at top ("Validation — 2 errors, 1 warning") with close button. Summary footer for passing count
- **Auto-open on publish attempt** with errors — panel opens automatically when user clicks Publish and errors exist
- **Manual toggle also supported** — toolbar Validation button toggles panel open/closed anytime, in addition to auto-open on publish
- Replaces the current validation modal entirely — remove the old `showValidation` modal overlay

### Publish Button Behavior
- **Visually disabled** with `disabled` attribute when validation errors exist — grayed out, cursor:not-allowed
- **Dynamic tooltip** on disabled button: "Fix N error(s) before publishing" — count updates reactively
- **Warnings do NOT block publish** — only errors disable the button
- **Server-side errors** (save failed, HTTP errors) shown via **Zag.js toasts** instead of the current red banner — auto-dismiss after 5 seconds
- **Success toast** shown after successful publish ("Skill published!")
- Remove the existing `publish-error` banner component and `publishError` state

### Warning-vs-Error Flow
- When publish is clicked with **warnings but no errors**: auto-open the validation panel with a "Publish Anyway" button in the panel footer (not a separate modal)
- When **no errors AND no warnings**: publish immediately, no confirmation. Show success toast
- When **errors exist**: publish button is disabled (no click handler fires)

### Error vs Warning Classification
- **Errors (block publish)**:
  - No chapters defined
  - Chapter missing instructions (guide)
  - Condition missing conditionText
  - Chapter has no tools assigned
- **Warnings (allow with confirm)**:
  - Skill has no custom name
  - Skill has no description
  - Chapters without output definitions
  - Chapters not connected (no edges)
  - Cycle detected (bounded by maxCycles)

### Shared Validation Module (VALID-04)
- **Location**: `src/lib/utils/skill-validation.ts` with colocated `skill-validation.test.ts`
- **Pure function**: `validateSkill(input: SkillValidationInput) => ValidationFinding[]`
- **Input shape**: plain data object `{ name, description, chapters, edges, chapterToolMap }` — no DB or Svelte dependency
- **Finding shape**: `{ level: 'error' | 'warning', message: string, chapterId: string | null, chapterName: string | null }` — enables per-chapter grouping and Fix button targeting
- **Only returns errors and warnings** — no 'ok' level findings. Client counts passing chapters separately for the summary line
- Imported by `skill-editor.svelte.ts` (client $derived) and `builder.service.ts` (server publish gate)
- Server filters to errors-only for the publish gate decision

### Accessibility (A11Y-01)
- Validation panel has `role="complementary"` with `aria-label="Skill validation"`
- All modals (delete confirmation, condition editor, chapter editor) use `role="dialog"` on the modal element (not backdrop) with `aria-labelledby` pointing to the modal title element

### Claude's Discretion
- Splitter resize implementation details (min/max width, persist width to localStorage)
- Toast position and styling (top-right vs bottom-right)
- Zag.js toast setup and integration pattern
- Exact animation/transition for panel open/close
- Whether to show a "Publish Anyway" button only when panel was auto-opened on publish vs always when warnings exist

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### State Module (validation logic source)
- `src/lib/state/builder/skill-editor.svelte.ts` — Current inline validation ($derived `_validationFindings`), state shape, publish flow. This is what gets refactored to use the shared module
- `src/lib/state/builder/index.ts` — Barrel exports for the builder state directory

### Server-side Validation
- `src/server/services/builder.service.ts` — `validateSkillForPublish()` function (lines 81-155). Current server-side validation with per-chapter error messages. Must be refactored to use the shared module
- `src/routes/api/builder/skills/[id]/+server.ts` — Publish API route that calls `validateSkillForPublish()`. Returns `{ ok: false, errors }` on validation failure

### Skill Editor Page
- `src/routes/(app)/builder/skills/[id]/+page.svelte` — Current validation modal (lines 270-302), publish error banner (lines 123-129), toolbar validation button (lines 91-105), publish button (lines 106-119). All of these get replaced/modified

### UI Components
- `src/lib/components/builder/ChapterEditor.svelte` — Chapter editor modal. Fix button will call `openChapterEditor()` to open this
- `src/lib/components/builder/ChapterDAG.svelte` — DAG canvas. Validation panel sits alongside this
- `src/lib/components/layout/Splitter.svelte` — Existing splitter component for resizable panels (if it exists — verify before using)

### Test Pattern
- `src/lib/utils/` — Existing colocated .test.ts files (e.g., format.test.ts). Follow this pattern for skill-validation.test.ts

### Phase 6 Decisions (carry forward)
- Error vs warning classification is consistent with Phase 6's server-side validation severity
- `publishSkill()` already has the dirty re-check (CFIX-06) — Phase 7 adds the disabled button as a second layer of protection

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `skillEditorDerived` getter pattern in `skill-editor.svelte.ts` — validation findings are already reactive via $derived. Phase 7 replaces the internals with the shared module
- `Splitter` component (if present in `src/lib/components/layout/`) — resizable panel divider
- `openChapterEditor()` function in skill-editor.svelte.ts — Fix button calls this with the chapter entry to open the editor
- `openConditionOrChapter()` — dispatches to condition editor or chapter editor based on type

### Established Patterns
- **State module pattern**: single $state object + exported getters + exported async functions
- **Modal pattern**: `{#if skillEditorState.editingChapter}` conditional rendering with overlay
- **CSS variables**: full theme palette (`--color-error`, `--color-warning`, `--color-success`, `--color-border`, etc.)
- **Toolbar buttons**: `.toolbar-btn` class with `.primary`, `.secondary`, `.published` variants

### Integration Points
- Validation button in toolbar (line 91-105) — currently toggles `showValidation` modal, will toggle inline panel
- Publish button (line 106-119) — currently always enabled, will be disabled when errors exist
- Publish error banner (lines 123-129) — will be replaced with Zag.js toasts
- DAG canvas section (line 227-239) — validation panel sits to the right of this

</code_context>

<specifics>
## Specific Ideas

- The "Publish Anyway" button should appear in the validation panel footer only when there are warnings but no errors and the user just attempted to publish. This avoids showing it when the user is just browsing validation state
- Zag.js toasts replace the current `publishError` state variable and banner — simplifies the state module
- The current `showValidation` boolean state toggles between panel open/closed instead of modal visible/hidden
- Validation findings are now per-chapter with IDs, enabling the panel to group and the Fix button to target specific chapters

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 07-validation-ux*
*Context gathered: 2026-03-19*
