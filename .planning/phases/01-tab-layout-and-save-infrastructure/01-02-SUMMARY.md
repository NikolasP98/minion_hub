---
phase: 01-tab-layout-and-save-infrastructure
plan: 02
subsystem: config-save-ux
tags: [toast, modal, navigation-guard, disconnect-banner, auto-save]
dependency_graph:
  requires: ["01-01"]
  provides: ["save-ux-hardening"]
  affects: ["src/lib/state/config/config.svelte.ts", "src/lib/components/config/ConfigSaveBar.svelte", "src/lib/components/config/NavigationGuardModal.svelte", "src/routes/settings/+page.svelte"]
tech_stack:
  added: []
  patterns: ["dismiss-by-ID toast pattern", "beforeNavigate modal guard", "effect-based auto-save queue"]
key_files:
  created:
    - src/lib/components/config/NavigationGuardModal.svelte
  modified:
    - src/lib/state/config/config.svelte.ts
    - src/lib/components/config/ConfigSaveBar.svelte
    - src/routes/settings/+page.svelte
decisions:
  - "toaster.create() returns string ID directly (confirmed from @zag-js/toast types), no UUID workaround needed"
  - "onRestartReconnected uses setTimeout(0) for immediate reset since toast handles dismiss timing"
  - "Auto-save effect skips when restartState.phase !== 'idle' to avoid conflict with restart cycle"
metrics:
  duration: 6min
  completed: "2026-03-12T05:45:38Z"
  tasks_completed: 2
  files_changed: 4
---

# Phase 01 Plan 02: Save/Restart UX Hardening Summary

Migrated restart indicator from ConfigSaveBar phases to persistent dismiss-by-ID toast, replaced native confirm() with custom NavigationGuardModal, and added disconnect-with-dirty warning banner with auto-save on reconnect.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Migrate restart indicator to toast, simplify ConfigSaveBar | fc01bf2 | config.svelte.ts, ConfigSaveBar.svelte |
| 2 | Navigation guard modal, disconnect banner, auto-save | c1d4aa0 | NavigationGuardModal.svelte, +page.svelte |

## Decisions Made

1. **toaster.create() return type**: Confirmed `@zag-js/toast`'s `Store.create()` returns `string` directly from the type declaration (`create: (data: Options<V>) => string`). No UUID workaround needed.

2. **setTimeout(0) for restart reset**: `onRestartReconnected()` uses `setTimeout(0)` instead of `RECONNECTED_DISMISS_MS` (3s) because the toast system manages its own dismiss timing. The restart state resets immediately, toasts handle their own visibility.

3. **Auto-save restart guard**: The `$effect` auto-save on reconnect checks `restartState.phase === 'idle'` before firing. When the gateway restarts due to a config change, the restart cycle handles reloading config itself — the auto-save would be redundant and could race.

## What Was Built

### config.svelte.ts

- Added `_restartToastId: string | null` module variable for dismiss-by-ID pattern
- `beginRestart()`: creates persistent `type: 'loading'` toast with `duration: Infinity`; dismisses previous toast if any
- Timeout handler (30s): dismisses toast, calls `toastError("Gateway didn't reconnect", "Try reconnecting manually")`
- `onRestartReconnected()`: dismisses restart toast, shows `toastSuccess` (no dirty) or `toastWarning` (dirty preserved)
- `save()`: removed `toastInfo('Gateway restarting…')` calls — `beginRestart()` handles toast now

### ConfigSaveBar.svelte

Stripped to dirty-state only. Removed all three restart-phase branches (`restarting`, `reconnected`, `failed`), removed `restartState`/`resetRestartState`/`wsConnect` imports, removed `restart-pulse`/`reconnected-bar`/`failed-bar` CSS classes.

### NavigationGuardModal.svelte

New Svelte 5 component: fixed overlay with backdrop blur, centered card modal. Props: `open` ($bindable), `onsave`, `ondiscard`, `oncancel`. Escape key and overlay click call `oncancel`. Inner card stops propagation to prevent overlay dismissal when clicking modal content.

### settings/+page.svelte

- Import `discard` and `NavigationGuardModal`
- `guardModalOpen` + `pendingNavigation` state
- `beforeNavigate`: cancels navigation when dirty, opens modal with pending navigation stored
- `handleGuardSave/Discard/Cancel`: save+navigate, discard+navigate, or close
- `pendingAutoSave` + `$effect`: sets flag on disconnect-with-dirty, fires `save()` on reconnect (idle only)
- Disconnect warning banner in gateway tab `{:else}` block (amber, above content)
- ConfigSaveBar condition: `isDirty.value || configState.saving || configState.saveError` (removed `restartState.phase !== 'idle'`)

## Deviations from Plan

### Pre-existing Out-of-Scope Issues

**ChannelsTab.svelte type errors** (deferred to deferred-items.md)
- Found during: Task 1 check run
- Issue: Missing `bot`, `application`, `self`, `tokenSource`, `dmPolicy` properties on channel status type
- Action: Logged to `deferred-items.md`, not fixed (pre-existing, out of scope)

None of the implementation tasks deviated from the plan.

## Self-Check: PASSED

All created files exist on disk. Both task commits (fc01bf2, c1d4aa0) confirmed in git log. All 144 tests pass. Type errors are pre-existing in ChannelsTab.svelte (out of scope).
