---
phase: 01-tab-layout-and-save-infrastructure
plan: 03
subsystem: ui
tags: [svelte, settings, config, disconnect-banner, dry]

# Dependency graph
requires:
  - phase: 01-tab-layout-and-save-infrastructure
    plan: 02
    provides: auto-save on reconnect, navigation guard modal, disconnect state tracking
provides:
  - Reachable disconnect warning banner in gateway config tabs
  - SettingsTabBar sourcing tab list from config-schema.ts (single source of truth)
affects: [settings, config-schema, tab-layout]

# Tech tracking
tech-stack:
  added: []
  patterns: [top-level conditional rendering before branch guards, DRY constant reuse via named import]

key-files:
  created: []
  modified:
    - src/routes/settings/+page.svelte
    - src/lib/components/settings/SettingsTabBar.svelte

key-decisions:
  - "Banner placed before {#if !conn.connected} block so it renders in both connected and disconnected states when isDirty is true"
  - "shrink-0 added to banner div to prevent flex compression in column layout"
  - "SettingsTabBar imports TABS from config-schema.ts; inline ALL_TABS removed entirely"

patterns-established:
  - "Top-level condition pattern: place cross-cutting UI (banners, alerts) before branch guards, not inside a specific branch"
  - "Single source of truth for tab list: config-schema.ts TABS is the canonical definition"

requirements-completed: [PLSH-03]

# Metrics
duration: 5min
completed: 2026-03-12
---

# Phase 1 Plan 03: Gap Closure Summary

**Disconnect warning banner made structurally reachable by moving it before the conn.connected branch guard; SettingsTabBar DRY-refactored to import TABS from config-schema.ts**

## Performance

- **Duration:** 5 min
- **Started:** 2026-03-12T06:07:00Z
- **Completed:** 2026-03-12T06:12:13Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- Fixed PLSH-03: amber disconnect banner now renders when `!conn.connected && isDirty.value` regardless of config load state
- Eliminated duplicate ALL_TABS constant in SettingsTabBar — future tab changes to config-schema.ts propagate automatically
- All 144 tests pass; no new type-check errors introduced

## Task Commits

Each task was committed atomically:

1. **Task 1: Fix unreachable disconnect banner (PLSH-03 blocker)** - `c165547` (fix)
2. **Task 2: Remove duplicate ALL_TABS — import TABS from config-schema.ts** - `edcd57d` (refactor)

**Plan metadata:** see final docs commit

## Files Created/Modified
- `src/routes/settings/+page.svelte` - Moved disconnect banner from inside `:else` block to top-level position before the `{#if !conn.connected}` guard
- `src/lib/components/settings/SettingsTabBar.svelte` - Replaced inline `ALL_TABS` with `import { TABS } from '$lib/utils/config-schema'`

## Decisions Made
- Banner placed at top level inside tab-panel div, before the `{#if !conn.connected}` conditional. This ensures it renders whenever disconnected+dirty regardless of whether config has been loaded.
- Added `shrink-0` to banner div to prevent flex compression in column flex layout.
- `ALL_TABS` constant removed entirely rather than kept as alias — it was identical to `TABS`, keeping it would perpetuate the DRY violation.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

Pre-existing type errors in `src/lib/components/channels/ChannelsTab.svelte` (13 errors, property `bot`/`application`/`self`/`tokenSource`/`dmPolicy` missing from channel type). These existed before this plan and are out of scope. No new errors introduced.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- PLSH-03 requirement is now satisfied: disconnect warning is structurally reachable
- Phase 01 gap closure complete — all three plans executed
- Ready for Phase 02 or subsequent phases

---
*Phase: 01-tab-layout-and-save-infrastructure*
*Completed: 2026-03-12*
