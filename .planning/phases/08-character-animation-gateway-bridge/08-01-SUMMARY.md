---
phase: 08-character-animation-gateway-bridge
plan: 01
subsystem: pixel-office
tags: [animation, constants, fsm, pathfinding, collision]
dependency-graph:
  requires: []
  provides: [animation-constants-consolidated, walkSpeedOverride, dynamic-collision-blocking]
  affects: [characters.ts, office-state.ts, types.ts, constants.ts]
tech-stack:
  added: []
  patterns: [single-source-of-truth constants, walkSpeedOverride pattern, dynamic-blocked-set per frame]
key-files:
  created: []
  modified:
    - src/lib/workshop/pixel/constants.ts
    - src/lib/workshop/pixel/types.ts
    - src/lib/workshop/pixel/characters.ts
    - src/lib/workshop/pixel/office-state.ts
decisions:
  - "Set walkSpeedOverride on both return-to-seat-after-wander and return-to-seat-when-active-resumed paths"
  - "withOwnSeatUnblocked now accepts explicit blockedSet parameter for composability with dynamic sets"
  - "getCharacterSprite WALK uses ch.frame % 2 (not % 4) to map 4-frame cycle to 2-frame sprites"
metrics:
  duration: 269s
  completed: "2026-03-23"
  tasks: 3
  files: 4
---

# Phase 08 Plan 01: Animation Constants and Collision Foundation Summary

**One-liner:** Consolidated animation constants (single source of truth), walk/read timing differentiation, return-to-seat 2x speed via walkSpeedOverride, and per-frame dynamic character collision blocking for BFS pathfinding.

## What Was Built

This plan establishes the foundation for all character animation behavior by fixing constants, consolidating imports, and wiring dynamic collision detection.

### Task 1 — constants.ts + types.ts (commit c8c025d)

Updated constants to match locked decisions:

| Constant | Old | New | Decision |
|---|---|---|---|
| `WALK_SPEED_PX_PER_SEC` | 48 | 64 | D-01 |
| `WANDER_PAUSE_MIN_SEC` | 2.0 | 30.0 | D-02 |
| `WANDER_PAUSE_MAX_SEC` | 20.0 | 60.0 | D-02 |
| `SEAT_REST_MIN_SEC` | 120.0 | 5.0 | D-07 |
| `SEAT_REST_MAX_SEC` | 240.0 | 15.0 | D-07 |

New exports added: `WALK_SPEED_RETURN_PX_PER_SEC = 128` (D-03), `READ_FRAME_DURATION_SEC = 0.5` (ANIM-03), `CHARACTER_DRAG_OFFSET_Y = -8`.

Character interface now has `walkSpeedOverride: number | null` field.

### Task 2 — characters.ts (commit bd92b1d)

- Removed 9 private constant declarations, replaced with imports from `./constants`
- TYPE state animation branches on `isReadingTool()`: 0.5s for reading tools, 0.3s for typing
- WALK movement uses `ch.walkSpeedOverride ?? WALK_SPEED_PX_PER_SEC` for speed calculation
- `walkSpeedOverride` set to `WALK_SPEED_RETURN_PX_PER_SEC` (128) on two return-to-seat paths:
  1. When wanderCount >= wanderLimit (wander cycle complete)
  2. When agent becomes active while idle (returning to work)
- `walkSpeedOverride` cleared to `null` on seat arrival
- `getCharacterSprite()` WALK: uses `ch.frame % 2` to map 4-frame cycle to 2-frame sprite array
- `createCharacter()` initializes `walkSpeedOverride: null`

### Task 3 — office-state.ts (commit 20d7177)

Per-character dynamic collision blocking in `update()`:

```
for each character ch:
  dynamicBlocked = new Set(this.blockedTiles)
  for each other character:
    if other.id === ch.id: skip
    if other.matrixEffect === 'despawn': skip
    dynamicBlocked.add(other.tileCol + other.tileRow * MAX_COLS)
  withOwnSeatUnblocked(ch, dynamicBlocked, () =>
    updateCharacter(ch, dt, ..., dynamicBlocked, findPath))
```

Updated `withOwnSeatUnblocked` signature to accept explicit `blockedSet: Set<number>` parameter. All callers updated: `reassignSeat`, `sendToSeat`, `walkToTile` pass `this.blockedTiles`; `update()` passes `dynamicBlocked`.

## Deviations from Plan

### Auto-fixed Issues

None — plan executed exactly as written with one minor addition.

### Auto-added (Rule 2 - Missing critical behavior)

**Added walkSpeedOverride on active-agent return path**

- **Found during:** Task 2
- **Issue:** Plan specified setting `walkSpeedOverride` when returning to seat after wander cycle, but the IDLE state also returns to seat when `isActive` becomes true. Both paths should use 2x speed for consistency.
- **Fix:** Added `ch.walkSpeedOverride = WALK_SPEED_RETURN_PX_PER_SEC` to both return-to-seat paths in IDLE state.
- **Files modified:** `src/lib/workshop/pixel/characters.ts`
- **Commit:** bd92b1d

## Known Stubs

None — all changes are concrete implementations with no placeholder values.

## Verification

All 5 success criteria confirmed:

1. `grep "WALK_SPEED_PX_PER_SEC = 64" constants.ts` — found
2. `grep -c "^const WALK_SPEED" characters.ts` — returns 0 (no private constants)
3. `grep "dynamicBlocked" office-state.ts` — found (3 occurrences)
4. `grep "walkSpeedOverride" types.ts` — found in Character interface
5. Type check: no errors in pixel/ files (pre-existing errors in unrelated files are out of scope)

## Self-Check: PASSED

Files verified:
- FOUND: src/lib/workshop/pixel/constants.ts
- FOUND: src/lib/workshop/pixel/types.ts
- FOUND: src/lib/workshop/pixel/characters.ts
- FOUND: src/lib/workshop/pixel/office-state.ts

Commits verified:
- FOUND: c8c025d (task 1)
- FOUND: bd92b1d (task 2)
- FOUND: 20d7177 (task 3)
