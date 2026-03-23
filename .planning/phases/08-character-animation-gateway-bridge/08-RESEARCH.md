# Phase 8: Character Animation + Gateway Bridge - Research

**Researched:** 2026-03-23
**Domain:** Canvas 2D pixel office animation, FSM-driven character behavior, gateway event wiring
**Confidence:** HIGH — all findings from direct codebase inspection

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01:** Walk speed is 64px/sec (~4 tiles/sec), brisk walk
- **D-02:** Idle wander pause duration is 30-60 seconds (rare wandering, chill office)
- **D-03:** When an idle wandering agent becomes active, character returns to seat at 2x walk speed (128px/sec)
- **D-04:** Walk animation uses 4 frames per direction, 4 directions (16 total frames)
- **D-05:** Character palette color is deterministic from agent ID (same agent = same color always)
- **D-06:** Idle agents can wander anywhere in the full office (no range limit)
- **D-07:** After finishing work, characters stay seated for 5-15 seconds before potentially wandering
- **D-08:** Use existing sprites as-is. If only 2 frames exist per direction, duplicate/mirror to create 4-frame walk illusion
- **D-09:** Sub-agents get temporary pixel characters — smaller/translucent character appears near parent, despawns when sub-agent completes
- **D-10:** Tool source uses both gateway presence tool names (preferred) with FSM state fallback (conversing→typing, reading→reading)
- **D-11:** Drag-to-reassign seats — users can drag a pixel character to a different desk to reassign them
- **D-12:** Agent name labels are always visible above characters (small pixel-font text)
- **D-13:** Characters treat other characters as blocked tiles — must pathfind around each other (block and reroute)
- **D-14:** New agents spawn at an auto-detected entrance tile (first walkable edge tile), then walk to their assigned seat
- **D-15:** Despawn plays matrix digital rain effect at the character's current position
- **D-16:** Seat assignment uses first available (unoccupied) seat in order
- **D-17:** On initial page load with already-connected agents, all characters appear directly at their seats (no entrance walk for initial load)
- **D-18:** CRT monitors swap to ON sprite when agent is typing, plus a subtle glow effect around the monitor
- **D-19:** Permission bubble is a pixel speech bubble with animated amber dots (•••) in classic retro style
- **D-20:** Done/waiting bubble is a green checkmark in a speech bubble, displayed for 2-3 seconds (brief flash)

### Claude's Discretion

- Typing vs reading animation visual distinction (same animation with different speed, or distinct poses — pick what works with existing 2-frame sprites)
- Cooldown state character behavior (seated idle pose vs subtle bob)
- Heartbeat state pixel reaction (brief pulse vs no reaction)
- Bubble data source approach (gateway presence only vs FSM+gateway hybrid)
- CRT glow color and intensity (green or blue, how large the glow radius)

### Deferred Ideas (OUT OF SCOPE)

- Click-to-select character (INTR-01) — Phase 9
- Mouse wheel zoom and pan (INTR-02, INTR-03) — Phase 9
- Status label showing current tool name (INTR-04) — Phase 9
- Character selection outline (INTR-05) — Phase 9
- Layout persistence (PERS-01 through PERS-04) — Phase 9
- PixiJS renderer migration — Phase 10
- Layout editor with furniture placement — Phase 11
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| ANIM-01 | Characters play 4-frame walk animation when wandering between tiles | `characters.ts` already implements `CharacterState.WALK` with 4-frame cycle at `WALK_FRAME_DURATION_SEC`. Constant tuning needed: `WALK_SPEED_PX_PER_SEC` 48→64, `SEAT_REST_MIN/MAX_SEC` 120-240→5-15, `WANDER_PAUSE_MIN/MAX_SEC` 2-20→30-60 |
| ANIM-02 | Characters play 2-frame typing animation when agent is conversing/writing | `characters.ts` TYPE state already runs 2-frame loop at `TYPE_FRAME_DURATION_SEC = 0.3s`. No new code needed — only constant wiring for when `isActive=true` |
| ANIM-03 | Characters play 2-frame reading animation when agent is reading files | `getCharacterSprite()` already branches on `isReadingTool(ch.currentTool)`. `READING_TOOLS` set in `characters.ts` covers Read/Grep/Glob/WebFetch/WebSearch. Reading visual = same 2 frames at slower cadence (0.5s per frame per UI-SPEC). New constant `READ_FRAME_DURATION_SEC = 0.5` needed |
| ANIM-04 | Characters wander via BFS pathfinding on tile grid when idle (respecting furniture walkability) | `tile-map.ts` `findPath()` + `getWalkableTiles()` fully implemented. `characters.ts` IDLE state picks random walkable tile and paths to it. Blocked tiles come from `office-state.ts` `blockedTiles`. Per D-13, occupied character tiles must be added to blockedTiles dynamically |
| ANIM-05 | Characters return to assigned seat when agent becomes active | `characters.ts` IDLE state already handles `ch.isActive` flip → pathfind to seat. D-03 requires 2x walk speed on return (128px/sec) — need a `returnSpeed` concept or temporary speed multiplier |
| ANIM-06 | Matrix digital rain effect plays on agent spawn/despawn (0.3s) | `matrix-effect.ts` fully implemented. `office-state.ts` `addAgent()`/`removeAgent()` already sets `matrixEffect='spawn'/'despawn'`. D-14 (entrance tile spawn) requires detecting first walkable edge tile and placing character there pre-spawn |
| GATE-01 | Workshop agent FSM states drive pixel character isActive and currentTool | `gateway-pixel-bridge.ts` `syncAgentState()` already reads FSM via `getAgentState()`. Enhancement needed: prefer `gw.presence` tool names over FSM fallback per D-10 |
| GATE-02 | Agent connect/disconnect adds/removes pixel characters with spawn/despawn effects | `syncAgentList()` in `gateway-pixel-bridge.ts` already handles add/remove. D-14 (entrance walk) and D-17 (initial load skip) are not yet implemented — need `skipSpawnEffect` + entrance-to-seat walk logic |
| GATE-03 | Agent tool activity (Write/Edit/Bash vs Read/Grep/Glob) maps to typing vs reading animation | D-10: bridge needs to read `gw.presence` entry for matching instanceId and extract current tool name, falling back to FSM state. `PresenceEntry` has `text`/`tags` fields but tool name is NOT directly in `PresenceEntry` — tool data comes from `pi-agent.tool-call` CustomEvents dispatched on `window` |
| GATE-04 | CRT monitors auto-switch to ON sprite when agent actively types at that desk | `office-state.ts` `rebuildFurnitureInstances()` already implements auto-ON logic using `autoOnTiles` set built from active agent seat facing direction. CRT glow effect (shadow draw) must be added to `renderer.ts` around monitor sprites |
| GATE-05 | Permission bubble (amber dots) shows when agent waits for user approval | `office-state.ts` has `showPermissionBubble(id)` / `clearPermissionBubble(id)`. Bridge needs to listen for gateway permission-wait events and call these. `pi-agent.tool-call` events with `permissionWait: true` in payload are the trigger |
| GATE-06 | Waiting bubble (green checkmark) shows when agent is idle after task completion | `office-state.ts` has `showWaitingBubble(id)`. Bridge needs to call this on FSM `conversationEnd`/`cooldown` transition. `WAITING_BUBBLE_DURATION_SEC = 2.0s` already in constants |
</phase_requirements>

---

## Summary

Phase 8 is a **wiring and tuning phase**, not a from-scratch build. The pixel office engine (15 modules, ~4,200 lines) is already ported from pixel-agents and operational. All the mechanics exist: character FSM (`characters.ts`), BFS pathfinding (`tile-map.ts`), matrix spawn/despawn (`matrix-effect.ts`), office state management (`office-state.ts`), gateway bridge module (`gateway-pixel-bridge.ts`), and the render pipeline (`renderer.ts`). The game loop is running in `WorkshopCanvas.svelte` and already calls `syncAgentList()` + `syncAgentState()` every frame.

The work in this phase has three distinct categories: (1) **constant tuning** — updating numeric parameters in `characters.ts` and `constants.ts` to match D-01 through D-08; (2) **bridge enhancement** — upgrading `gateway-pixel-bridge.ts` to use `gw.presence` + `pi-agent.tool-call` window events for real-time tool detection (D-10), add entrance-tile spawn logic (D-14), handle initial-load skip (D-17), wire sub-agents (D-09), and trigger bubbles (GATE-05/06); and (3) **renderer additions** — adding CRT monitor glow (D-18), agent name labels (D-12), and sub-agent visual distinction (D-09 translucency).

**Primary recommendation:** Work in three sequential waves. Wave 0: constant tuning (D-01 through D-08). Wave 1: bridge wiring (GATE-01 through GATE-06 excluding CRT glow). Wave 2: renderer additions (name labels, sub-agent alpha, CRT glow, animated permission bubble dots).

---

## Standard Stack

This phase uses no new external dependencies. All work is within the existing stack.

### Core (already installed)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| SvelteKit 2 + Svelte 5 | `^2.x` | App framework + reactive state | Project-wide standard |
| Canvas 2D API | browser native | Pixel rendering | Already used by pixel office engine |
| Bun | 1.x | Package manager + runner | Project-wide (`minion_hub/`) |
| TypeScript strict | 5.x | Type safety | Project convention |
| Vitest | detected in `vitest.config.ts` | Unit tests | Project test runner |

**No new packages needed.** All animation, pathfinding, and rendering logic is self-contained in `src/lib/workshop/pixel/`.

---

## Architecture Patterns

### Project Structure (existing — do not reorganize)

```
src/lib/workshop/pixel/
├── characters.ts       # Character FSM + walk/type/read/idle logic
├── gateway-pixel-bridge.ts  # Workshop FSM → pixel character state mapping
├── office-state.ts     # Central OfficeState class (characters, seats, furniture)
├── matrix-effect.ts    # Spawn/despawn visual effect
├── renderer.ts         # Canvas 2D draw calls (tiles, furniture, characters, bubbles)
├── sprite-data.ts      # Sprite storage + palette/hue shift
├── game-loop.ts        # rAF-based update/render loop
├── tile-map.ts         # BFS pathfinding + walkable tile detection
├── constants.ts        # All numeric constants (centralized)
├── types.ts            # CharacterState, Direction, TILE_SIZE, Character interface
```

### Pattern 1: Constant-First Tuning

All per-frame numeric parameters live in `constants.ts` (exported) and are imported into `characters.ts`. The constants in `characters.ts` are private module-level vars that shadow them — **this is a gap to fix**. The planner should update both the `characters.ts` private constants AND the `constants.ts` exported values to stay in sync.

Current values vs required values per locked decisions:

| Constant | File | Current | Required (D-xx) |
|----------|------|---------|-----------------|
| `WALK_SPEED_PX_PER_SEC` | `characters.ts` line 23 | 48 | 64 (D-01) |
| `WANDER_PAUSE_MIN_SEC` | `characters.ts` line 27 | 2.0 | 30.0 (D-02) |
| `WANDER_PAUSE_MAX_SEC` | `characters.ts` line 28 | 20.0 | 60.0 (D-02) |
| `SEAT_REST_MIN_SEC` | `characters.ts` line 31 | 120.0 | 5.0 (D-07) |
| `SEAT_REST_MAX_SEC` | `characters.ts` line 32 | 240.0 | 15.0 (D-07) |

Note: `constants.ts` exports `WALK_SPEED_PX_PER_SEC = 48` at line 7 — this also needs updating. The `characters.ts` module-level constants are separate from the `constants.ts` exports; they are not imported. The planner should consolidate: make `characters.ts` import from `constants.ts` to avoid drift.

**New constant needed** for ANIM-03 (reading animation slower cadence):
```typescript
// Add to constants.ts
export const READ_FRAME_DURATION_SEC = 0.5;
```

**Existing constants NOT to change** (already correct or deferred):
- `WALK_FRAME_DURATION_SEC = 0.15` — correct for 4-frame cycle
- `TYPE_FRAME_DURATION_SEC = 0.3` — correct
- `MATRIX_EFFECT_DURATION_SEC = 0.3` — correct
- `WAITING_BUBBLE_DURATION_SEC = 2.0` — correct

### Pattern 2: Return-to-Seat Speed (D-03)

The `WALK_SPEED_PX_PER_SEC` constant is used globally for all movement. D-03 requires 2x speed (128px/sec) when an agent transitions from wandering back to their seat. The `Character` interface should gain an optional `walkSpeedOverride: number | null` field, or the approach can be a simple multiplier flag `isReturningToSeat: boolean`. The FSM handles this: when `isActive` flips `true` while `state === IDLE` or `state === WALK` heading to a wander tile, the character re-paths to seat at 2x speed.

**Recommended approach:** Add `walkSpeedOverride: number | null` to the `Character` interface in `types.ts`. Set to `128` when a previously-wandering character becomes active. Clear to `null` once seated.

### Pattern 3: Character Collision Blocking (D-13)

Characters must block each other's pathfinding. The `blockedTiles: Set<number>` on `OfficeState` currently only contains furniture. Each frame before calling `updateCharacter()`, occupied tile keys from other characters should be added to a temporary blocked set. The `withOwnSeatUnblocked()` pattern already exists for self-exclusion.

**Current gap:** `OfficeState.update()` calls `updateCharacter()` with `this.blockedTiles` which only has furniture. To add character blocking, build a `dynamicBlockedTiles` each frame:

```typescript
// In OfficeState.update():
const dynamicBlocked = new Set(this.blockedTiles);
for (const other of this.characters.values()) {
  if (other.id === ch.id) continue;
  dynamicBlocked.add(other.tileCol + other.tileRow * MAX_COLS);
}
// Pass dynamicBlocked instead of this.blockedTiles to updateCharacter()
```

This is a per-frame allocation. At 10 agents it is trivially cheap. At Phase 10 (PixiJS migration) this can be optimized if needed.

### Pattern 4: Gateway Tool Detection (D-10, GATE-03)

The `PresenceEntry` interface in `gateway.ts` does NOT contain tool name fields. Tool names come from `pi-agent.tool-call` gateway events, which `gateway.svelte.ts` dispatches as `CustomEvent` on `window` (line 427). The bridge must listen to these window events.

**Event payload structure** (from `types.ts` `ToolActivity` and gateway event naming):
```typescript
// pi-agent.tool-call event payload shape (inferred from usage)
interface ToolCallPayload {
  agentId: string;
  instanceId?: string;     // present when running under a workshop instance
  toolId: string;          // tool name: "Write", "Read", "Bash", etc.
  status: string;          // "running" | "done" | "error"
  done: boolean;
  permissionWait?: boolean; // true when awaiting user approval
}
```

**Bridge enhancement** in `gateway-pixel-bridge.ts`:

```typescript
// Add to module init (called once when bridge is active):
function startToolCallListener(): () => void {
  function onToolCall(e: Event) {
    const payload = (e as CustomEvent).detail as ToolCallPayload;
    // Match agentId to instanceId via workshopState.agents
    // Update office.setAgentTool(charId, payload.done ? null : payload.toolId)
    // Trigger permission bubble: office.showPermissionBubble(charId)
  }
  window.addEventListener('pi-agent.tool-call', onToolCall);
  return () => window.removeEventListener('pi-agent.tool-call', onToolCall);
}
```

The FSM state fallback (D-10) remains for agents that don't emit `pi-agent.tool-call` events: `conversing` → `'Write'`, `reading` → `'Read'`.

### Pattern 5: Entrance Tile Spawn (D-14)

New agents must spawn at the "first walkable edge tile" of the layout grid, then walk to their seat. Edge tiles are those where `col === 0`, `col === cols-1`, `row === 0`, or `row === rows-1`. The first walkable one (scanning top-left to bottom-right) becomes the entrance.

```typescript
function findEntranceTile(office: OfficeState): { col: number; row: number } | null {
  const { layout, tileMap, blockedTiles } = office;
  // Check top row first, then left column, then bottom, then right
  // Return first walkable tile
}
```

This tile is computed once per layout and cached. Characters spawned during runtime (not initial load) start at this tile with `matrixEffect = 'spawn'`, then after the 0.3s effect completes, walk to their assigned seat.

**D-17 initial load handling:** The `initPixelOffice()` function in `WorkshopCanvas.svelte` already calls `addAgent(charId)` for each `workshopState.agents` entry. The `addAgent()` call already accepts `skipSpawnEffect?: boolean`. Pass `skipSpawnEffect: true` for initial load agents so they appear directly at seats without the matrix effect or entrance walk.

### Pattern 6: Sub-Agent Visual Distinction (D-09)

Sub-agent characters already have `isSubagent: boolean` and `parentAgentId: number | null` on the `Character` interface. The `addSubagent()` / `removeSubagent()` methods exist on `OfficeState`.

The bridge needs to listen to `pi-agent.subagent-spawned` and `pi-agent.subagent-completed` window events to call `office.addSubagent()` / `office.removeSubagent()`.

In `renderer.ts`, the render path for characters should check `ch.isSubagent` and apply:
```typescript
if (ch.isSubagent) {
  ctx.save();
  ctx.globalAlpha = 0.65; // per UI-SPEC
  // draw at 0.75x scale per UI-SPEC D-09
  ctx.restore();
}
```

### Pattern 7: Agent Name Labels (D-12)

Name labels are drawn on canvas above each character, using `ctx.font = "bold 7px 'JetBrains Mono NF'"`. Labels are rendered AFTER all characters in `renderBubbles()` pass — add a `renderNameLabels()` function in `renderer.ts` called from `renderFrame()` after `renderBubbles()`.

```typescript
export function renderNameLabels(
  ctx: CanvasRenderingContext2D,
  characters: Character[],
  instanceToCharId: Map<string, number>,  // reverse lookup from bridge
  agents: Record<string, AgentInstance>,  // from workshopState.agents
  offsetX: number, offsetY: number, zoom: number,
): void
```

The name for each character requires reversing `charId → instanceId` (via `getInstanceForCharId()` already exported from bridge) then looking up `workshopState.agents[instanceId].agentId` then `gw.agents.find(a => a.id === agentId)?.name`.

### Anti-Patterns to Avoid

- **Building a separate tool-call state store:** The bridge should update `office.setAgentTool()` directly on receipt of window events. No additional reactive state module is needed.
- **Modifying `this.blockedTiles` permanently in update():** Character collision must use a temporary set built per-frame, NOT mutate the furniture-based `blockedTiles`. Permanent mutation would corrupt pathfinding.
- **Calling `rebuildFurnitureInstances()` every frame:** `setAgentActive()` already calls this. Only call it when `isActive` state changes, not on every `syncAgentState()` invocation.
- **Re-loading all characters when `syncAgentList()` detects no changes:** `syncAgentList()` should early-exit if `currentInstances` matches the current `instanceToCharId` map.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| BFS pathfinding | Custom graph search | `findPath()` in `tile-map.ts` | Already implemented with blocked-tile support and pathIndex optimization |
| Matrix spawn/despawn | Custom pixel effect | `renderMatrixEffect()` in `matrix-effect.ts` | Complete, per-pixel, column-staggered implementation |
| Character animation FSM | Custom state machine | `updateCharacter()` + `CharacterState` enum | Full FSM with walk/type/idle + seat timer + wander logic |
| Sprite palette/hue shift | Custom color transform | `getCharacterSprites(palette, hueShift)` in `sprite-data.ts` | Handles palette count, hue rotation, and offscreen canvas caching |
| Sprite pixel caching | Custom canvas caching | `getCachedSprite()` in `sprite-cache.ts` | Zoom-keyed cache, prevents per-frame reallocation |
| Furniture ON-state detection | Manual furniture type checks | `getOnStateType()` + `getAnimationFrames()` from `furniture-catalog.ts` | Catalog-driven, handles animation frames |
| Sub-agent tracking | Custom Map | `subagentIdMap` + `subagentMeta` on `OfficeState` | Already implemented with negative ID scheme |
| Bubble rendering | Custom bubble draw code | `renderBubbles()` + `getBubbleSprite()` | Sprite-based with fade timer already wired |

---

## Common Pitfalls

### Pitfall 1: Constants Drift Between `characters.ts` and `constants.ts`

**What goes wrong:** `characters.ts` defines its own private constants (lines 22-32) that are separate from the exported constants in `constants.ts`. Updating one without the other causes visible but confusing behavior (wrong speed in game but correct export value).

**Why it happens:** The module was written self-contained. `constants.ts` was added later for the renderer.

**How to avoid:** The first task in Wave 0 should consolidate: make `characters.ts` import `WALK_SPEED_PX_PER_SEC`, `WALK_FRAME_DURATION_SEC`, `TYPE_FRAME_DURATION_SEC`, `WANDER_PAUSE_MIN_SEC`, `WANDER_PAUSE_MAX_SEC`, `SEAT_REST_MIN_SEC`, `SEAT_REST_MAX_SEC` from `constants.ts` and delete the private copies.

**Warning signs:** Walk speed looks unchanged after updating `constants.ts`.

### Pitfall 2: `rebuildFurnitureInstances()` Called Too Frequently

**What goes wrong:** `rebuildFurnitureInstances()` is O(furniture count) and rebuilds the entire furniture array. Calling it from `syncAgentState()` every frame causes significant GC pressure.

**Why it happens:** `syncAgentState()` updates `ch.isActive` which should trigger a CRT switch. The naive approach is to call `rebuildFurnitureInstances()` after any state change. But `syncAgentState()` runs every frame.

**How to avoid:** Track prior `isActive` value before updating. Only call `rebuildFurnitureInstances()` when `isActive` actually changed:
```typescript
if (ch.isActive !== shouldBeActive) {
  ch.isActive = shouldBeActive;
  office.setAgentActive(ch.id, shouldBeActive); // this internally calls rebuildFurnitureInstances
}
```
`setAgentActive()` on `OfficeState` already calls `rebuildFurnitureInstances()` — use that instead of setting `ch.isActive` directly.

### Pitfall 3: Character Collision Blocks Seat Pathfinding

**What goes wrong:** If character A is standing on character B's seat tile, B can never pathfind home (the seat is in `blockedTiles` from furniture AND now from character A).

**Why it happens:** Adding all character positions to `blockedTiles` naively blocks seats that are occupied.

**How to avoid:** The existing `withOwnSeatUnblocked()` pattern handles this for furniture-blocked seats. For character-blocking, use the same approach: when building `dynamicBlockedTiles`, do NOT add the target character's own seat tile. `OfficeState.update()` already has this logic skeleton via `withOwnSeatUnblocked()`.

### Pitfall 4: D-17 Initial Load Spawns Entrance Walk

**What goes wrong:** `WorkshopCanvas.svelte` `initPixelOffice()` calls `office.addAgent(charId)` for existing agents without `skipSpawnEffect: true`. Characters do a matrix effect + entrance walk on every page reload even though they were already seated.

**Why it happens:** `addAgent()` defaults to `skipSpawnEffect = false` (spawns with matrix effect) and places the character at a seat position already — but the current code does NOT place them at the entrance tile either. The result is: matrix effect at seat + no entrance walk (current behavior misses D-14 for runtime connects AND D-17 for initial load).

**How to avoid:**
- Initial load path (`initPixelOffice()`): call `addAgent(charId, ..., skipSpawnEffect: true)` — character appears at seat immediately
- Runtime connect path (`syncAgentList()` detecting new agent): detect entrance tile, place character there, call `addAgent()` with normal spawn effect, then the character's FSM drives them to walk to seat

### Pitfall 5: Window Event Listener Memory Leak

**What goes wrong:** `window.addEventListener('pi-agent.tool-call', ...)` in the bridge is never cleaned up when the pixel office tears down (mode switch or host disconnect).

**Why it happens:** `gateway-pixel-bridge.ts` is a module with no lifecycle. Listeners accumulate on repeated mode switches.

**How to avoid:** Return a cleanup function from the listener registration. Call it in `teardownPixelOffice()` in `WorkshopCanvas.svelte`. Store the cleanup fn reference alongside `stopPixelLoop`.

### Pitfall 6: Sub-Agent `parentAgentId` Resolution

**What goes wrong:** `addSubagent(parentAgentId: number, parentToolId: string)` takes a pixel character ID, not a gateway instanceId or agentId. The bridge receives a gateway `agentId` in the `pi-agent.subagent-spawned` event payload.

**Why it happens:** The pixel layer uses numeric IDs while the gateway uses string IDs.

**How to avoid:** The bridge already has `getCharIdForInstance(instanceId)` to convert. The event payload's `agentId` must be resolved to an `instanceId` via `workshopState.agents` (find entry where `entry.agentId === payload.agentId`), then to `charId` via `getCharIdForInstance()`.

---

## Code Examples

### Correct: Constant Update Pattern

```typescript
// characters.ts — BEFORE (private constants, drift-prone)
const WALK_SPEED_PX_PER_SEC = 48;     // ← private, not from constants.ts
const WANDER_PAUSE_MIN_SEC = 2.0;

// characters.ts — AFTER (import from constants.ts, single source of truth)
import {
  WALK_SPEED_PX_PER_SEC,
  WALK_FRAME_DURATION_SEC,
  TYPE_FRAME_DURATION_SEC,
  READ_FRAME_DURATION_SEC,     // new
  WANDER_PAUSE_MIN_SEC,
  WANDER_PAUSE_MAX_SEC,
  SEAT_REST_MIN_SEC,
  SEAT_REST_MAX_SEC,
} from './constants';
```

### Correct: Reading Animation Slower Cadence (ANIM-03)

The `updateCharacter()` TYPE state switch currently uses a single `TYPE_FRAME_DURATION_SEC`:
```typescript
// characters.ts updateCharacter() TYPE case — current
if (ch.frameTimer >= TYPE_FRAME_DURATION_SEC) {
  ch.frameTimer -= TYPE_FRAME_DURATION_SEC;
  ch.frame = (ch.frame + 1) % 2;
}

// AFTER — branch on reading tool
const frameDuration = isReadingTool(ch.currentTool)
  ? READ_FRAME_DURATION_SEC   // 0.5s — slower for reading
  : TYPE_FRAME_DURATION_SEC;  // 0.3s — normal for typing
if (ch.frameTimer >= frameDuration) {
  ch.frameTimer -= frameDuration;
  ch.frame = (ch.frame + 1) % 2;
}
```

### Correct: Walk Speed Override for Return-to-Seat (D-03)

```typescript
// In updateCharacter() WALK case, movement calculation:
const speed = ch.walkSpeedOverride ?? WALK_SPEED_PX_PER_SEC;
ch.moveProgress += (speed / TILE_SIZE) * dt;

// Clear override when seated:
// In WALK complete, when arriving at seat:
ch.state = CharacterState.TYPE;
ch.walkSpeedOverride = null;

// Set override in syncAgentState when agent becomes active while wandering:
if (!wasActive && shouldBeActive && ch.state !== CharacterState.TYPE) {
  ch.walkSpeedOverride = WALK_SPEED_RETURN_PX_PER_SEC; // 128
}
```

### Correct: Dynamic Character Collision (D-13)

```typescript
// OfficeState.update() — add before updateCharacter() call
const dynamicBlocked = new Set(this.blockedTiles);
for (const other of this.characters.values()) {
  if (other.id === ch.id) continue;
  if (other.matrixEffect === 'despawn') continue; // despawning chars don't block
  dynamicBlocked.add(other.tileCol + other.tileRow * MAX_COLS);
}
// In withOwnSeatUnblocked, use dynamicBlocked instead of this.blockedTiles:
this.withOwnSeatUnblocked(ch, () =>
  updateCharacter(ch, dt, this.walkableTiles, this.seats, this.tileMap, dynamicBlocked, findPath),
);
```

### Correct: Entrance Tile Detection (D-14)

```typescript
// In gateway-pixel-bridge.ts or office-state.ts utility
function findEntranceTile(
  tileMap: TileTypeVal[][],
  blockedTiles: Set<number>,
): { col: number; row: number } | null {
  const rows = tileMap.length;
  const cols = rows > 0 ? tileMap[0].length : 0;
  // Scan edge tiles: top row L→R, left col T→B, bottom row L→R, right col T→B
  const edges: Array<{ col: number; row: number }> = [];
  for (let c = 0; c < cols; c++) edges.push({ col: c, row: 0 });
  for (let r = 1; r < rows; r++) edges.push({ col: 0, row: r });
  for (let c = 1; c < cols; c++) edges.push({ col: c, row: rows - 1 });
  for (let r = 1; r < rows - 1; r++) edges.push({ col: cols - 1, row: r });
  for (const tile of edges) {
    if (isWalkable(tile.col, tile.row, tileMap, blockedTiles)) return tile;
  }
  return null;
}
```

### Correct: CRT Glow Effect (D-18, UI-SPEC)

CRT glow is drawn in `renderer.ts` using `ctx.shadowBlur` around ON-state monitor sprites. It must be applied in `renderScene()` selectively for furniture tiles facing an active agent.

```typescript
// In renderScene(), when drawing furniture that is in auto-ON state:
// (The auto-ON detection already happens in rebuildFurnitureInstances)
// For each furniture item where type ends with '_on':
ctx.save();
ctx.shadowColor = 'rgba(0, 255, 120, 0.4)';  // UI-SPEC value
ctx.shadowBlur = 6;                            // UI-SPEC value
ctx.drawImage(cached, fx, fy);
ctx.restore();
```

Caveat: `ctx.shadowBlur` is expensive at 60fps. Only apply to ON-state furniture. The `furniture-catalog.ts` `getOnStateType()` function tells us if a type has an ON variant — use this to gate the shadow.

### Correct: Permission Bubble — Animated Dots (D-19)

The existing `renderBubbles()` draws a sprite from `getBubbleSprite('permission')`. D-19 requires animated amber dots (•••). Options:

1. Use multiple sprite frames for the bubble (pre-animated) — requires asset creation
2. Draw the dots programmatically in canvas as 3 filled circles with staggered alpha based on `Date.now() % cycle`

**Recommended:** Programmatic dot animation using `bubbleTimer` already incremented on `Character`. Modulo the timer to cycle dot phases:

```typescript
// In renderBubbles(), for permission bubble type:
const dotPhase = Math.floor((Date.now() / 300)) % 3; // advances every 0.3s
// Draw 3 dots at positions relative to bubble center, dim all except current
for (let i = 0; i < 3; i++) {
  ctx.fillStyle = i === dotPhase
    ? 'rgba(255, 255, 255, 1.0)'
    : 'rgba(255, 255, 255, 0.3)';
  // draw pixel at bubble_x + (i * 4), bubble_y
}
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `path.shift()` per tile step — O(n) | `pathIndex` counter on Character | Already implemented | No O(n) allocation per step |
| `Array.from(characters.values())` every frame | `_characterArray` cache with dirty flag | Already implemented | No allocation on static frames |
| All character state in OfficeState | Separate `characters.ts` for FSM logic | Already implemented | Clean separation |
| Walk speed in `characters.ts` module | Drift between `characters.ts` and `constants.ts` | Gap to fix in Phase 8 | Bug risk |

**Deprecated/outdated in current code:**
- `WANDER_PAUSE_MIN/MAX_SEC = 2.0/20.0`: These values produce rapid random wandering. D-02 changes this to 30-60s for a "chill office" feel.
- `SEAT_REST_MIN/MAX_SEC = 120.0/240.0`: These produce 2-4 minute rests at seat after arriving. D-07 changes this to 5-15s so characters feel more responsive.

---

## Open Questions

1. **`pi-agent.tool-call` event payload shape is inferred, not confirmed**
   - What we know: `gateway.svelte.ts` line 424-428 dispatches `pi-agent.tool-call` as a `CustomEvent` with `detail: evt.payload`
   - What's unclear: The exact fields in `evt.payload`. The `ToolActivity` interface in `types.ts` (line 84-89) defines `toolId`, `status`, `done`, `permissionWait` but this is a local type, not the gateway wire format
   - Recommendation: The implementer should add a `console.log` on the event listener in dev to verify the actual payload shape before writing production parsing code. The `ToolActivity` interface is a reasonable guess.

2. **Agent instanceId resolution from `pi-agent.tool-call` events**
   - What we know: `workshopState.agents` maps `instanceId → AgentInstance` where `AgentInstance.agentId` is the gateway agent ID
   - What's unclear: Whether `pi-agent.tool-call` payload includes `instanceId` (workshop instance) or only `agentId` (gateway agent)
   - Recommendation: When multiple workshop instances of the same agent exist, tool events must be routed by `instanceId` not `agentId`. If only `agentId` is in the payload, find all workshop instances for that agentId and update all of them.

3. **D-05 deterministic palette from agentId — current implementation uses round-robin**
   - What we know: `pickDiversePalette()` in `office-state.ts` picks the least-used palette (balanced distribution), not a deterministic hash from agentId
   - What's unclear: Whether D-05 means "implement a hash" or "the current balanced approach is acceptable since agents always reconnect with the same assignment"
   - Recommendation: If seat persistence is not implemented yet (Phase 9), palette assignments reset on page reload anyway. A deterministic hash from agentId is more correct per D-05 but the current balanced approach is functionally acceptable for Phase 8. The planner should implement a simple hash: `agentId.charCodeAt(0) % PALETTE_COUNT` as the preferred palette hint passed to `addAgent()`.

---

## Environment Availability

Step 2.6: SKIPPED (no external dependencies — this phase is purely TypeScript/Canvas code changes within the existing project)

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest (detected in `vitest.config.ts`) |
| Config file | `/home/nikolas/Documents/CODE/AI/minion_hub/vitest.config.ts` |
| Quick run command | `bun run vitest run src/lib/workshop/pixel/` |
| Full suite command | `bun run test` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| ANIM-01 | Walk speed = 64px/sec, 4-frame cycle | unit | `bun run vitest run src/lib/workshop/pixel/characters.test.ts` | ❌ Wave 0 |
| ANIM-02 | TYPE state cycles 2 frames at 0.3s each | unit | same | ❌ Wave 0 |
| ANIM-03 | Reading tool → slower 0.5s frame cadence | unit | same | ❌ Wave 0 |
| ANIM-04 | BFS path respects blocked tiles | unit | `bun run vitest run src/lib/workshop/pixel/tile-map.test.ts` | ❌ Wave 0 |
| ANIM-05 | Active flag → character paths to seat | unit | `bun run vitest run src/lib/workshop/pixel/characters.test.ts` | ❌ Wave 0 |
| ANIM-06 | Spawn/despawn sets matrixEffect field | unit | same | ❌ Wave 0 |
| GATE-01 | FSM conversing → isActive=true | unit | `bun run vitest run src/lib/workshop/pixel/gateway-pixel-bridge.test.ts` | ❌ Wave 0 |
| GATE-02 | syncAgentList adds/removes characters | unit | same | ❌ Wave 0 |
| GATE-03 | Write/Bash tool → typing; Read/Grep → reading | unit | same | ❌ Wave 0 |
| GATE-04 | Active agent at seat → CRT ON via rebuildFurnitureInstances | unit | `bun run vitest run src/lib/workshop/pixel/office-state.test.ts` | ❌ Wave 0 |
| GATE-05 | permissionWait event → showPermissionBubble called | unit | `bun run vitest run src/lib/workshop/pixel/gateway-pixel-bridge.test.ts` | ❌ Wave 0 |
| GATE-06 | conversationEnd → showWaitingBubble called | unit | same | ❌ Wave 0 |

### Sampling Rate

- **Per task commit:** `bun run vitest run src/lib/workshop/pixel/`
- **Per wave merge:** `bun run test`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps

- [ ] `src/lib/workshop/pixel/characters.test.ts` — covers ANIM-01, ANIM-02, ANIM-03, ANIM-05, ANIM-06
- [ ] `src/lib/workshop/pixel/tile-map.test.ts` — covers ANIM-04 (BFS with blocked tiles)
- [ ] `src/lib/workshop/pixel/office-state.test.ts` — covers GATE-04 (CRT auto-ON)
- [ ] `src/lib/workshop/pixel/gateway-pixel-bridge.test.ts` — covers GATE-01, GATE-02, GATE-03, GATE-05, GATE-06

No framework install needed — Vitest is already installed and configured.

---

## Project Constraints (from CLAUDE.md)

- **Svelte 5 only**: runes (`$state`, `$derived`, `$effect`), snippets, `onclick={}` syntax. No legacy Svelte 4 patterns.
- **TypeScript strict mode**: no `any`, no `@ts-nocheck`
- **Package manager**: Bun for `minion_hub/`. Do not use npm or pnpm here.
- **Path aliases**: `$lib` → `src/lib/`, `$server` → `src/server/`
- **Formatting**: use `bun run check` (svelte-check + tsc) before commit
- **Git workflow**: feature branches → `dev` → `main`. Never commit to `main` directly.
- **Multi-agent safety**: do not touch git stash, worktrees, or switch branches
- **Canvas layer**: All pixel office rendering is Canvas 2D, not PixiJS. The PixiJS migration is Phase 10 — do not introduce PixiJS into the pixel office modules.
- **No new dependencies**: This phase requires no new packages.

---

## Sources

### Primary (HIGH confidence)

- Direct codebase inspection of all 15 pixel office modules in `src/lib/workshop/pixel/`
- `src/lib/components/workshop/WorkshopCanvas.svelte` — full game loop wiring verified
- `src/lib/workshop/agent-fsm.ts` — all FSM states and transitions confirmed
- `src/lib/state/gateway/gateway-data.svelte.ts` — `gw.presence` structure confirmed
- `src/lib/services/gateway.svelte.ts` — `pi-agent.tool-call` window dispatch confirmed (line 424-428)
- `src/lib/workshop/pixel/types.ts` — `Character` interface, all fields confirmed
- `src/lib/workshop/pixel/constants.ts` — all exported constant values confirmed
- `src/lib/workshop/pixel/characters.ts` — private constants confirmed, drift gap identified
- `.planning/phases/08-character-animation-gateway-bridge/08-UI-SPEC.md` — visual contract confirmed
- `.planning/phases/08-character-animation-gateway-bridge/08-CONTEXT.md` — all decisions confirmed

### Secondary (MEDIUM confidence)

- `pi-agent.tool-call` event payload shape inferred from `ToolActivity` interface in `types.ts` and gateway event dispatch pattern — actual wire format not verified from gateway source

### Tertiary (LOW confidence)

- None

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all from direct codebase inspection
- Architecture patterns: HIGH — all patterns derived from existing code, gaps identified from code gaps not assumptions
- Pitfalls: HIGH — all identified by tracing actual code paths, not hypothetical

**Research date:** 2026-03-23
**Valid until:** 2026-04-23 (stable codebase, no fast-moving external dependencies)
