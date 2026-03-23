---
phase: 08-character-animation-gateway-bridge
plan: 03
subsystem: pixel-office
tags: [rendering, animations, name-labels, crt-glow, drag-to-reassign, sub-agents, permission-bubble]
dependency-graph:
  requires: [gateway-fsm-to-character-bridge, animation-constants-consolidated]
  provides: [name-labels, crt-glow, sub-agent-visuals, permission-dots, drag-to-reassign]
  affects: [renderer.ts, characters.ts, WorkshopCanvas.svelte, types.ts, layout-serializer.ts]
tech-stack:
  added: []
  patterns: [OfficeRef-inline-interface-for-circular-import-avoidance, isOnState-furniture-flag, module-level-drag-state]
key-files:
  created: []
  modified:
    - src/lib/workshop/pixel/renderer.ts
    - src/lib/workshop/pixel/characters.ts
    - src/lib/components/workshop/WorkshopCanvas.svelte
    - src/lib/workshop/pixel/types.ts
    - src/lib/workshop/pixel/layout-serializer.ts
decisions:
  - "isOnState boolean added to FurnitureInstance (set in layoutToFurnitureInstances) so renderer can apply CRT glow without knowing furniture type strings"
  - "OfficeRef inline interface in characters.ts avoids circular import with office-state.ts"
  - "renderDragOverlays requires selection to be always-passed to renderFrame (removed selectedAgentId guard)"
  - "Drag detection in handlePointerDown runs before panning to give character drag priority over canvas pan"
metrics:
  duration: 390s
  completed: "2026-03-23"
  tasks: 2
  files: 5
---

# Phase 08 Plan 03: Visual Polish and Drag Interaction Summary

**One-liner:** Agent name labels (bold 7px JetBrains Mono NF), CRT green glow on active monitors, sub-agent 0.65 alpha / 0.75x scale, animated amber permission dots, and drag-to-reassign seat interaction with seat highlight overlays.

## What Was Built

This plan adds all visual and interaction polish to the pixel office, completing the character animation gateway bridge phase.

### Task 1 — Renderer additions (commit 3d97395)

**Name labels (D-12):**

Added `renderNameLabels()` function called from `renderFrame()` after speech bubbles (on top of everything):
- Font: `bold 7px 'JetBrains Mono NF'`
- Color: `#ffffff` with `rgba(0,0,0,0.8)` drop shadow offset by 1 zoom unit
- Name truncated at 12 chars with `...` suffix
- Sub-agent format: `"[parent name] >"` at 0.7 opacity
- Resolves charId → instanceId → agentId → gw.agents.name via getInstanceForCharId

**CRT monitor glow (D-18):**

Added `isOnState?: boolean` to `FurnitureInstance` in types.ts. Set in `layoutToFurnitureInstances` when `item.type.endsWith('_on')`. In `renderScene`, ON-state furniture draws with `ctx.shadowColor = 'rgba(0, 255, 120, 0.4)'` and `ctx.shadowBlur = 6` inside a save/restore. Guard: `isOnState === true` — never applied to inactive monitors.

**Sub-agent visuals (D-09):**

In `renderScene` character loop, `isSubagent` characters draw with:
```
ctx.globalAlpha = 0.65
ctx.translate(center); ctx.scale(0.75, 0.75); ctx.translate(-center)
```

**Animated permission bubble dots (D-19):**

Replaced static permission sprite with canvas-drawn amber pill and 3 cycling dots:
- Background: `rgba(245, 158, 11, 0.9)` pill via `ctx.roundRect` (fallback: `ctx.rect`)
- 3 dots cycle via `Math.floor(Date.now() / 300) % 3`
- Active dot: `rgba(255, 255, 255, 1.0)`, inactive: `rgba(255, 255, 255, 0.3)`
- Waiting bubble uses existing sprite path (unchanged)

**Drag state rendering:**

`renderScene` reads `getDragState()` and renders dragged character at cursor + `CHARACTER_DRAG_OFFSET_Y` (-8px) with `ctx.globalAlpha = 0.85`. Added `renderDragOverlays()` showing green/red seat highlights when drag is active.

### Task 2 — Drag-to-reassign interaction (commit 102f6a3)

**characters.ts drag functions:**

Module-level state tracks: `draggedCharId`, `dragOriginalSeatId`, `dragOriginalCol/Row`, `dragWorldX/Y`.

| Export | Purpose |
|--------|---------|
| `getDragState()` | Returns `{charId, worldX, worldY}` for renderer |
| `findCharacterAtWorld(office, worldX, worldY)` | Hit-test using CHARACTER_HIT_HALF_WIDTH/HEIGHT |
| `dragCharacter(id, characters)` | Start drag, single-drag safety guard |
| `updateDragPosition(worldX, worldY)` | Update drag cursor coords |
| `dropCharacter(office, worldX, worldY)` | Drop on empty seat → reassignSeat; else cancelDrag |
| `cancelDrag(office)` | Restore character to original tile position |

Used inline `OfficeRef` interface to avoid circular dependency (`office-state.ts` → `characters.ts` → circular).

**WorkshopCanvas.svelte wiring:**

- `handlePointerDown`: checks for character hit first; if found starts drag (priority over pan)
- `handlePointerMove`: updates drag position while `isPixelDragging`
- `handlePointerUp`: drops character at pointer position
- `window.addEventListener('mouseup', handlePixelMouseupWindow)`: catches drops outside canvas
- `window.addEventListener('keydown', handlePixelKeydown)`: Escape cancels drag
- `cleanupPixelDragListeners` variable cleaned up in `teardownPixelOffice`
- `sel` object always passed to `renderFrame` (removed `selectedAgentId !== null` guard) so drag overlays render even without selection

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Circular dependency between characters.ts and office-state.ts**

- **Found during:** Task 2 implementation
- **Issue:** Plan instructed `import type { OfficeState } from './office-state'` in characters.ts, but office-state.ts already imports `createCharacter, updateCharacter` from characters.ts — creating a circular dependency.
- **Fix:** Defined an inline `OfficeRef` interface with only the fields needed (`characters`, `seats`, `reassignSeat`). TypeScript structural typing means `OfficeState` satisfies `OfficeRef` without the import.
- **Files modified:** `src/lib/workshop/pixel/characters.ts`
- **Commit:** 102f6a3

**2. [Rule 2 - Missing critical] isOnState flag needed on FurnitureInstance for CRT glow**

- **Found during:** Task 1 implementation
- **Issue:** `FurnitureInstance` had no `type` field — only `sprite` (a 2D color array). The renderer couldn't identify ON-state furniture without type info. Plan assumed type string would be accessible.
- **Fix:** Added `isOnState?: boolean` to `FurnitureInstance` in types.ts. Set in `layoutToFurnitureInstances` when `item.type.endsWith('_on')`. Renderer reads `f.isOnState === true`.
- **Files modified:** `src/lib/workshop/pixel/types.ts`, `src/lib/workshop/pixel/layout-serializer.ts`
- **Commit:** 3d97395

**3. [Rule 2 - Missing critical] sel always passed to renderFrame for drag overlays**

- **Found during:** Task 2, wiring drag overlays into renderFrame
- **Issue:** WorkshopCanvas.svelte only created `sel` when `selectedAgentId !== null`. Drag overlays need `selection.seats` but drag often occurs without selection. Renders nothing.
- **Fix:** Changed `sel` to always be constructed with seats/characters, removing the `selectedAgentId !== null` guard. `renderSeatIndicators` already handles null selectedAgentId by returning early.
- **Files modified:** `src/lib/components/workshop/WorkshopCanvas.svelte`
- **Commit:** 102f6a3

## Known Stubs

None — all visual features are fully wired.

- Name labels: connected to real `gw.agents` data via `getInstanceForCharId`
- CRT glow: connected to real furniture ON/OFF state via `isOnState` flag
- Permission dots: connected to real `ch.bubbleType === 'permission'` from gateway events
- Drag: calls real `office.reassignSeat` on valid drop

## Verification

All 10 success criteria confirmed:

1. `grep "renderNameLabels" renderer.ts` — found x2 (function definition + call in renderFrame)
2. `grep "bold 7px.*JetBrains" renderer.ts` — found
3. `grep "shadowBlur" renderer.ts` — found (guarded by isOnState === true)
4. `grep "endsWith.*_on\|isOnState" layout-serializer.ts renderer.ts` — found in both
5. `grep "globalAlpha.*0.65" renderer.ts` — found
6. `grep "dragCharacter" characters.ts` — found
7. `grep "findCharacterAtWorld" characters.ts` — found
8. `grep "mousedown\|mousemove\|mouseup" WorkshopCanvas.svelte` — found
9. `grep "getDragState" renderer.ts` — found
10. `bun run check` — 0 new errors in modified pixel office files; pre-existing errors in ChannelsTab.svelte and builder pages are out of scope

## Self-Check: PASSED

Files verified:
- FOUND: src/lib/workshop/pixel/renderer.ts
- FOUND: src/lib/workshop/pixel/characters.ts
- FOUND: src/lib/components/workshop/WorkshopCanvas.svelte
- FOUND: src/lib/workshop/pixel/types.ts
- FOUND: src/lib/workshop/pixel/layout-serializer.ts

Commits verified:
- FOUND: 3d97395 (task 1 - renderer visual polish)
- FOUND: 102f6a3 (task 2 - drag-to-reassign interaction)
