---
phase: 08-character-animation-gateway-bridge
plan: 02
subsystem: pixel-office
tags: [gateway-bridge, animation, tool-calls, sub-agents, entrance-spawn, event-listeners]
dependency-graph:
  requires: [animation-constants-consolidated, walkSpeedOverride, dynamic-collision-blocking]
  provides: [gateway-fsm-to-character-bridge, tool-call-listener, entrance-spawn, sub-agent-events, crt-auto-on]
  affects: [gateway-pixel-bridge.ts, office-state.ts, WorkshopCanvas.svelte]
tech-stack:
  added: []
  patterns: [window-event-listener-cleanup, deterministic-palette-hash, cached-entrance-tile, fsm-driven-character-state]
key-files:
  created: []
  modified:
    - src/lib/workshop/pixel/gateway-pixel-bridge.ts
    - src/lib/workshop/pixel/office-state.ts
    - src/lib/components/workshop/WorkshopCanvas.svelte
decisions:
  - "setAgentActive guarded with ch.isActive !== shouldBeActive to prevent rebuildFurnitureInstances every frame (Pitfall 2)"
  - "FSM tool fallback only applies when ch.currentTool is null to avoid racing with real tool-call events (D-10)"
  - "Entrance tile placed at end of addAgent+spawn sequence so character position overrides seat assignment for runtime connects (D-14)"
  - "syncAgentList initial-load block kept for demo agents (no real agents) to allow graceful fallback"
metrics:
  duration: 420s
  completed: "2026-03-23"
  tasks: 3
  files: 3
---

# Phase 08 Plan 02: Character Animation Gateway Bridge Summary

**One-liner:** Gateway FSM and window tool-call events now drive pixel character isActive, currentTool, CRT-ON state, permission/waiting bubbles, entrance-tile spawn with matrix effect, and sub-agent lifecycle — with full cleanup on teardown.

## What Was Built

This plan wires the gateway bridge to make pixel characters react to real agent activity. All three tasks completed in a single pass.

### Task 1 — syncAgentState and setAgentTool (commit 0b5a1e1)

Enhanced `gateway-pixel-bridge.ts` with proper state management:

| Change | Detail |
|---|---|
| `office.setAgentActive()` | Replaced direct `ch.isActive = shouldBeActive` — triggers `rebuildFurnitureInstances` for CRT auto-ON (GATE-04) |
| Change guard | `if (ch.isActive !== shouldBeActive)` prevents rebuild every frame (Pitfall 2) |
| `walkSpeedOverride` | Set to `WALK_SPEED_RETURN_PX_PER_SEC` when agent becomes active while not seated (D-03) |
| FSM tool fallback | Only applied when `ch.currentTool` is null — avoids racing with real tool-call events (D-10) |
| `setAgentTool()` exported | Helper for tool-call event listener to set real tool names |
| `paletteFromAgentId()` exported | djb2-style hash maps agentId → deterministic palette index (D-05) |
| Waiting bubble | `syncAgentState` calls `office.showWaitingBubble` on FSM `cooldown` transition (GATE-06) |

### Task 2 — findEntranceTile and syncAgentList update (commit 2ee70eb + part of 0b5a1e1)

Added `findEntranceTile()` to `OfficeState`:

```
Scan edges: top row L→R, left col T→B, bottom row L→R, right col T→B
Return first walkable tile (isWalkable check)
Cache result in _entranceTile (undefined = not computed, null = none found)
Invalidate cache in rebuildFromLayout()
```

Updated `syncAgentList()`:
- Accepts `isInitialLoad = false` parameter
- `isInitialLoad=true`: calls `office.addAgent(charId, palette, undefined, undefined, true)` — skips spawn effect (D-17)
- `isInitialLoad=false`: calls `office.addAgent(charId, palette)` then positions character at entrance tile (D-14)
- Uses `paletteFromAgentId(agentId, PALETTE_COUNT)` for deterministic palette assignment (D-05)
- Added early-exit when no changes detected (optimization)

### Task 3 — Tool/subagent listeners and WorkshopCanvas wiring (commit fd3cb5f)

New exported functions in `gateway-pixel-bridge.ts`:

**`startToolCallListener(office)`** — Returns cleanup function:
- Handles `pi-agent.tool-call` window events
- Resolves `agentId`/`instanceId` → charId
- Calls `setAgentTool` with real tool name (or null when done)
- Shows `showPermissionBubble` on `permissionWait=true` (GATE-05)
- Clears permission bubble on `done=true`

**`startSubagentListener(office)`** — Returns cleanup function:
- Handles `pi-agent.subagent-spawned` → `office.addSubagent(parentCharId, toolId)` (D-09)
- Handles `pi-agent.subagent-completed` → `office.removeSubagent(parentCharId, toolId)` (D-09)

`WorkshopCanvas.svelte` updates:
- Imports `startToolCallListener`, `startSubagentListener`
- `cleanupToolListener` and `cleanupSubagentListener` variables track cleanup functions
- Initial agent load uses `syncAgentList(pixelOffice, true)` — no spawn effects on page load (D-17)
- Game loop uses `syncAgentList(pixelOffice, false)` — runtime connects get entrance spawn (D-14)
- Listeners started after game loop begins: `cleanupToolListener = startToolCallListener(pixelOffice)`
- `teardownPixelOffice` calls both cleanup functions and `clearMappings()` (Pitfall 5)

## Deviations from Plan

### Auto-fixed Issues

None — plan executed exactly as written.

### Minor adjustments

**syncAgentList initial-load block preserved for demo agents**

The plan's `syncAgentList` approach for initial agents replaced the manual loop, but the `else` branch (no real agents → 3 demo characters) was kept intact since `syncAgentList` with `isInitialLoad=true` only handles actual workshop agents. Demo characters still use the direct `allocateCharId/registerMapping/addAgent` pattern.

## Known Stubs

None — all event handler logic is fully wired to real gateway window events dispatched by `src/lib/services/gateway.svelte.ts`.

## Verification

All 6 success criteria confirmed:

1. `grep "setAgentActive"` in gateway-pixel-bridge.ts — found (GATE-04)
2. `grep "pi-agent.tool-call"` in gateway-pixel-bridge.ts — found (GATE-03)
3. `grep "findEntranceTile"` in office-state.ts — found (D-14)
4. `grep "showWaitingBubble"` in gateway-pixel-bridge.ts — found (GATE-06)
5. `grep "removeEventListener"` in gateway-pixel-bridge.ts — found x3 (Pitfall 5)
6. `bun run check` — 0 errors in modified pixel office files; pre-existing errors in ChannelsTab.svelte and builder pages are out of scope

## Self-Check: PASSED

Files verified:
- FOUND: src/lib/workshop/pixel/gateway-pixel-bridge.ts
- FOUND: src/lib/workshop/pixel/office-state.ts
- FOUND: src/lib/components/workshop/WorkshopCanvas.svelte

Commits verified:
- FOUND: 0b5a1e1 (task 1 - bridge enhancements)
- FOUND: 2ee70eb (task 2 - findEntranceTile)
- FOUND: fd3cb5f (task 3 - listener wiring)
