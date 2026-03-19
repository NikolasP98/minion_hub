---
phase: 07-validation-ux
plan: 02
subsystem: builder-state
tags: [validation, state-refactor, toasts, shared-module]
dependency_graph:
  requires: [07-01]
  provides: [VALID-04, VALID-01, VALID-05]
  affects: [skill-editor-state, builder-service, publish-flow]
tech_stack:
  added: []
  patterns: [shared-validation-module, toast-feedback, publish-gate]
key_files:
  created: []
  modified:
    - src/lib/state/builder/skill-editor.svelte.ts
    - src/lib/state/builder/index.ts
    - src/server/services/builder.service.ts
    - src/routes/api/builder/skills/[id]/+server.ts
    - src/routes/(app)/builder/skills/[id]/+page.svelte
decisions:
  - "publishError state removed — replaced entirely with toastError/toastSuccess calls to avoid stale error state in UI"
  - "handlePublishClick is the new publish entry point — gates on warnings before calling publishSkill()"
  - "Server validateSkillForPublish filters findings to errors only — warnings do not block publish at the server level"
  - "chapterToolMap built via batch query in server service (same as before), passed into shared validateSkill()"
metrics:
  duration: 10 min
  completed_date: 2026-03-19
  tasks: 2
  files: 5
---

# Phase 07 Plan 02: Wire Shared Validation Module Summary

Wired the shared validateSkill() pure function into both the client-side Svelte state and the server-side publish service, replacing all duplicate inline validation logic and migrating publish error feedback to toasts.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Refactor skill-editor.svelte.ts | 2786343 | skill-editor.svelte.ts, index.ts, +page.svelte |
| 2 | Refactor builder.service.ts | c8f9327 | builder.service.ts, +server.ts |

## What Was Built

**Client-side (Task 1):**
- `_validationFindings` derived now calls `validateSkill()` from `$lib/utils/skill-validation` — replaces 85 lines of inline logic with a 10-line call
- Local `ValidationFinding` interface removed; imported from shared module (type is now `'error' | 'warning'` only, no `'ok'`)
- `publishError` state field removed; `toastError`/`toastSuccess` calls added to `publishSkill()`
- `publishAnyway` boolean added to state, reset in `cleanupSkillEditor()`
- `handlePublishClick()` exported — implements warning-gate: opens validation panel if warnings exist, calls `publishSkill()` directly if clean
- `_validationCounts` no longer has `ok` field; `_validationTooltip` shows 'All checks passing' when clean
- Barrel `index.ts` updated: `ValidationFinding` re-exported from skill-validation.ts, `handlePublishClick` added

**Server-side (Task 2):**
- `validateSkillForPublish()` in `builder.service.ts` now fetches DB data, builds `SkillValidationInput`, calls `validateSkill()`, filters to errors only
- Removed all inline `missingGuide`, `missingCondition`, BFS reachability logic (~80 lines)
- `ValidationResult` interface unchanged — same public API for callers
- API route `PUT /api/builder/skills/[id]` now calls `validateSkillForPublish` before publishing, returns 400 with errors array on failure

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed publishError references in +page.svelte**
- **Found during:** Task 1
- **Issue:** `+page.svelte` referenced `skillEditorState.publishError` in template and had `validationCounts.ok` in validation footer
- **Fix:** Removed publishError DOM block entirely; removed ok count from validation summary line
- **Files modified:** src/routes/(app)/builder/skills/[id]/+page.svelte
- **Commit:** 2786343

## Verification

- `bun run vitest run src/lib/utils/skill-validation.test.ts`: 39/39 tests passed
- `bun run check`: no errors in modified files (pre-existing errors in unrelated files: ChannelsTab.svelte, AgentCreateWizard.svelte, auth.ts, builder/tools page)

## Self-Check: PASSED

- src/lib/state/builder/skill-editor.svelte.ts — modified, committed in 2786343
- src/lib/state/builder/index.ts — modified, committed in 2786343
- src/server/services/builder.service.ts — modified, committed in c8f9327
- Commit 2786343 exists: `git log --oneline | grep 2786343`
- Commit c8f9327 exists: `git log --oneline | grep c8f9327`
