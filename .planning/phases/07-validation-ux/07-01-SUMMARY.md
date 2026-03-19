---
phase: 07-validation-ux
plan: 01
subsystem: testing
tags: [validation, pure-function, tdd, typescript, vitest]

# Dependency graph
requires: []
provides:
  - "Pure validateSkill(input: SkillValidationInput): ValidationFinding[] function"
  - "SkillValidationInput and ValidationFinding exported types"
  - "Per-chapter finding targeting via chapterId/chapterName fields"
  - "Shared validation module usable by both client $derived and server publish gate"
affects: [07-02, 07-03, 12-versioning]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Pure TypeScript validation function with no Svelte/DB/external imports"
    - "Colocated test file pattern (skill-validation.test.ts beside skill-validation.ts)"
    - "TDD: RED commit (test only) then GREEN commit (implementation)"

key-files:
  created:
    - src/lib/utils/skill-validation.ts
    - src/lib/utils/skill-validation.test.ts
  modified: []

key-decisions:
  - "Error/warning classification finalised: chapter missing guide and chapter with no tools are ERRORS (not warnings as in old inline code)"
  - "Condition nodes are NOT checked for tools or guide — only conditionText is validated"
  - "Early return after no-chapters error so no per-chapter checks run on empty input"
  - "Cycle detection uses same DFS visited/stack algorithm as existing skill-editor.svelte.ts"
  - "ValidationFinding.level union is 'error' | 'warning' only — no 'ok' level"

patterns-established:
  - "validateSkill(): SkillValidationInput -> ValidationFinding[] — colocated pure function, zero external imports"
  - "chapterId=null / chapterName=null for skill-level findings; set for chapter-level findings"

requirements-completed: [VALID-04, VALID-03]

# Metrics
duration: 5min
completed: 2026-03-19
---

# Phase 07 Plan 01: Shared Skill Validation Function Summary

**Pure validateSkill() function with per-chapter error targeting using chapterId/chapterName fields, reclassifying tools and guide as errors, enabling Fix button UX in Plans 07-02 and 07-03**

## Performance

- **Duration:** 5 min
- **Started:** 2026-03-19T07:16:14Z
- **Completed:** 2026-03-19T07:21:30Z
- **Tasks:** 1 (TDD: RED + GREEN)
- **Files modified:** 2

## Accomplishments
- Extracted pure `validateSkill()` function from inline `$derived` in `skill-editor.svelte.ts`
- Added `chapterId`/`chapterName` fields to `ValidationFinding` for per-chapter error targeting
- Reclassified "chapter missing guide" and "chapter with no tools" from warnings to errors (VALID-03)
- 39 tests covering all 18 plan behavior groups, all passing

## Task Commits

Each task was committed atomically:

1. **RED: Failing test suite** - `8ea115e` (test)
2. **GREEN: validateSkill implementation** - `20b5b22` (feat)

**Plan metadata:** (docs commit follows)

_Note: TDD plan — two commits per TDD cycle (test → feat)_

## Files Created/Modified
- `src/lib/utils/skill-validation.ts` — Pure validateSkill() function, SkillValidationInput and ValidationFinding types (115 lines)
- `src/lib/utils/skill-validation.test.ts` — 39 tests across 18 test groups (520 lines)

## Decisions Made
- Chapter nodes (type='chapter') require both guide text and tools — both are errors when missing. Conditions only require conditionText.
- `ValidationFinding.level` typed as `'error' | 'warning'` — no `'ok'` level. Callers count passing chapters separately.
- TypeScript flagged `f.level !== 'ok'` comparisons as unreachable in tests (correct — the type union proves it). Fixed by casting to `string` to preserve the contract test without type errors.

## Deviations from Plan

None — plan executed exactly as written.

## Issues Encountered
- `bun run check` showed pre-existing TypeScript errors in `ChannelsTab.svelte` and builder pages (not caused by this plan). Zero errors in new files after Test 12 cast fix.

## Next Phase Readiness
- `validateSkill` is ready to be imported by `skill-editor.svelte.ts` (Plan 07-02) for the client $derived panel
- `validateSkill` is ready to be imported by `builder.service.ts` (Plan 07-02/07-03) for server-side publish gate
- Type contract (`SkillValidationInput`, `ValidationFinding`) is the stable interface for both consumers

---
*Phase: 07-validation-ux*
*Completed: 2026-03-19*
