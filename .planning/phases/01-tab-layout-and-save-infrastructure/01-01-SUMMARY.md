---
phase: 01-tab-layout-and-save-infrastructure
plan: 01
subsystem: ui
tags: [svelte5, settings, tabs, config-schema, dirty-tracking]

# Dependency graph
requires: []
provides:
  - 8-tab settings layout (hosts/ai/agents/comms/security/system/backups/appearance)
  - ChannelsTab merged inside Comms panel (no standalone tab)
  - Per-tab dirty dot indicator driven by dirtyTabIds derived set
  - Default settings landing page is Hosts (?s=hosts)
  - TABS constant with 8 entries and no channels key in TAB_MAPPING
affects: [02-tab-layout-and-save-infrastructure, settings page, config panels]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Dirty dot on tab: accent-colored 6px dot shown at top-right of inactive tabs when dirtyTabIds.has(tab.id)"
    - "ChannelsTab integration pattern: hub-managed component rendered inside gateway tab panel via {#if tab.id === 'comms'}"
    - "dirtyTabIds derived from dirtyGroupIds using SECURITY_GROUP_IDS carve-out + getGroupsForTab lookup"

key-files:
  created: []
  modified:
    - src/lib/utils/config-schema.ts
    - src/lib/utils/config-schema.test.ts
    - src/lib/components/settings/SettingsTabBar.svelte
    - src/routes/settings/+page.svelte

key-decisions:
  - "Channels tab removed; ChannelsTab component rendered inside the Comms gateway panel section (same pattern as TeamTab in Security, BindingsTab in Agents)"
  - "dirtyTabIds uses SECURITY_GROUP_IDS carve-out first, then falls back to getGroupsForTab lookup — consistent with how groups are already routed"
  - "Dirty dot hidden when tab is active (user is already looking at the dirty content)"
  - "Default tab changed from 'appearance' to 'hosts' per locked tab order decision"

patterns-established:
  - "TDD for config-schema changes: update tests first (RED), then fix implementation (GREEN)"
  - "Hub-managed tab sections integrated inline via {#if tab.id === 'x'} inside gateway tab panels"

requirements-completed: [LAYOUT-01, LAYOUT-04, LAYOUT-05]

# Metrics
duration: 3min
completed: 2026-03-12
---

# Phase 01 Plan 01: Tab Layout and Save Infrastructure Summary

**Settings page reorganized to 8 tabs (channels merged into Comms), default landing changed to Hosts, dirty dot indicators added to SettingsTabBar**

## Performance

- **Duration:** 3 min
- **Started:** 2026-03-12T00:36:19Z
- **Completed:** 2026-03-12T00:39:30Z
- **Tasks:** 3
- **Files modified:** 4

## Accomplishments

- Removed standalone Channels tab; ChannelsTab now renders inside the Comms gateway panel (after gateway config groups)
- Updated `TABS` constant to 8 entries in order: Hosts, AI, Agents, Comms, Security, System, Backups, Appearance
- Added `dirtyTabIds` derived set to settings page and `dirtyTabIds` prop to SettingsTabBar for per-tab unsaved-change indicators

## Task Commits

Each task was committed atomically:

1. **Task 1: Update tests to expect new tab structure (RED)** - `3f13756` (test)
2. **Task 2: Update config-schema implementation to pass tests (GREEN)** - `8efb0e3` (feat)
3. **Task 3: Add dirty dot to SettingsTabBar, restructure settings page** - `17a653a` (feat)

_Note: Tasks 1-2 follow TDD: tests updated first to RED state, then implementation fixed to GREEN._

## Files Created/Modified

- `src/lib/utils/config-schema.ts` - Removed channels from TABS array; replaced channels key with backups in TAB_MAPPING
- `src/lib/utils/config-schema.test.ts` - Updated expected tab order, added TAB_MAPPING no-channels test
- `src/lib/components/settings/SettingsTabBar.svelte` - Added dirtyTabIds prop and dirty dot indicator; removed MessageSquare icon and channels entry
- `src/routes/settings/+page.svelte` - Default tab hosts, HUB_TAB_IDS without channels, ChannelsTab inside Comms panel, dirtyTabIds derived, passes dirtyTabIds to SettingsTabBar

## Decisions Made

- ChannelsTab integrated inside the Comms gateway panel using the same `{#if tab.id === '...'}` inline section pattern established by TeamTab (security) and BindingsTab (agents)
- `dirtyTabIds` derived computation handles the SECURITY_GROUP_IDS carve-out first to avoid counting security-carved groups as comms/agents/ai dirty
- Dirty dot is hidden when the tab is active (user is already viewing that tab's content)

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

Pre-existing type errors in `src/lib/components/channels/ChannelsTab.svelte` (13 errors: `bot`, `application`, `self`, `tokenSource`, `dmPolicy` properties missing on a channel status type) were present before this plan. These are out of scope per deviation rules (not caused by this plan's changes). Logged to deferred items.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Tab structure foundation complete; all subsequent settings plans can reference the 8-tab layout
- TABS constant, TAB_MAPPING, and getGroupsForTab are stable contracts for config routing
- SettingsTabBar accepts dirtyTabIds prop — ready for per-tab save state wiring in plan 02

## Self-Check: PASSED

- FOUND: src/lib/utils/config-schema.ts
- FOUND: src/lib/utils/config-schema.test.ts
- FOUND: src/lib/components/settings/SettingsTabBar.svelte
- FOUND: src/routes/settings/+page.svelte
- FOUND: .planning/phases/01-tab-layout-and-save-infrastructure/01-01-SUMMARY.md
- FOUND: commit 3f13756 (test RED)
- FOUND: commit 8efb0e3 (feat GREEN)
- FOUND: commit 17a653a (feat dirty-dot + restructure)

---
*Phase: 01-tab-layout-and-save-infrastructure*
*Completed: 2026-03-12*
