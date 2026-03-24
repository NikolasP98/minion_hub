# Phase 8: Character Animation + Gateway Bridge - Context

**Gathered:** 2026-03-23
**Status:** Ready for planning

<domain>
## Phase Boundary

Pixel characters animate and behave according to real-time gateway agent states — typing when conversing, reading when scanning files, wandering when idle, with spawn/despawn effects on connect/disconnect. This phase wires existing modules together (characters.ts, gateway-pixel-bridge.ts, matrix-effect.ts, agent-fsm.ts) and tunes animation behavior.

</domain>

<decisions>
## Implementation Decisions

### Animation Timing & Feel
- **D-01:** Walk speed is 64px/sec (~4 tiles/sec), brisk walk
- **D-02:** Idle wander pause duration is 30-60 seconds (rare wandering, chill office)
- **D-03:** When an idle wandering agent becomes active, character returns to seat at 2x walk speed (128px/sec)
- **D-04:** Walk animation uses 4 frames per direction, 4 directions (16 total frames)
- **D-05:** Character palette color is deterministic from agent ID (same agent = same color always)
- **D-06:** Idle agents can wander anywhere in the full office (no range limit)
- **D-07:** After finishing work, characters stay seated for 5-15 seconds before potentially wandering
- **D-08:** Use existing sprites as-is. If only 2 frames exist per direction, duplicate/mirror to create 4-frame walk illusion

### Gateway-to-Pixel Mapping
- **D-09:** Sub-agents get temporary pixel characters — smaller/translucent character appears near parent, despawns when sub-agent completes
- **D-10:** Tool source uses both gateway presence tool names (preferred) with FSM state fallback (conversing→typing, reading→reading)
- **D-11:** Drag-to-reassign seats — users can drag a pixel character to a different desk to reassign them
- **D-12:** Agent name labels are always visible above characters (small pixel-font text)
- **D-13:** Characters treat other characters as blocked tiles — must pathfind around each other (block and reroute)

### Spawn/Despawn
- **D-14:** New agents spawn at an auto-detected entrance tile (first walkable edge tile), then walk to their assigned seat
- **D-15:** Despawn plays matrix digital rain effect at the character's current position
- **D-16:** Seat assignment uses first available (unoccupied) seat in order
- **D-17:** On initial page load with already-connected agents, all characters appear directly at their seats (no entrance walk for initial load)

### CRT Monitor & Bubbles
- **D-18:** CRT monitors swap to ON sprite when agent is typing, plus a subtle glow effect around the monitor
- **D-19:** Permission bubble is a pixel speech bubble with animated amber dots (•••) in classic retro style
- **D-20:** Done/waiting bubble is a green checkmark in a speech bubble, displayed for 2-3 seconds (brief flash)

### Claude's Discretion
- Typing vs reading animation visual distinction (same animation with different speed, or distinct poses — pick what works with existing 2-frame sprites)
- Cooldown state character behavior (seated idle pose vs subtle bob)
- Heartbeat state pixel reaction (brief pulse vs no reaction)
- Bubble data source approach (gateway presence only vs FSM+gateway hybrid)
- CRT glow color and intensity (green or blue, how large the glow radius)

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Pixel office modules
- `src/lib/workshop/pixel/characters.ts` — Character FSM with walk/type/idle states, createCharacter, updateCharacter, walk speed constants
- `src/lib/workshop/pixel/gateway-pixel-bridge.ts` — Workshop FSM → pixel character mapping, syncAgentState, syncAgentList
- `src/lib/workshop/pixel/office-state.ts` — OfficeState class with addAgent/removeAgent, seats, blockedTiles, character collection
- `src/lib/workshop/pixel/matrix-effect.ts` — Matrix digital rain spawn/despawn effect (0.3s duration)
- `src/lib/workshop/pixel/renderer.ts` — Canvas 2D rendering for tiles, furniture, characters, bubbles
- `src/lib/workshop/pixel/types.ts` — CharacterState enum, Character interface, Seat interface, TILE_SIZE constant
- `src/lib/workshop/pixel/sprite-data.ts` — CharacterSprites type, sprite frame data
- `src/lib/workshop/pixel/game-loop.ts` — rAF-based update/render loop with delta time capping
- `src/lib/workshop/pixel/tile-map.ts` — BFS pathfinding (findPath), walkable tile detection
- `src/lib/workshop/pixel/constants.ts` — All rendering constants (bubble offsets, animation timers, etc.)

### Workshop infrastructure
- `src/lib/workshop/agent-fsm.ts` — Agent finite state machine (idle, wandering, conversing, reading, cooldown, heartbeat, dragged)
- `src/lib/state/workshop/workshop.svelte.ts` — Workshop state management, agents map, view mode
- `src/lib/components/workshop/WorkshopCanvas.svelte` — Canvas mount point, view mode switching, pixel office initialization

### Gateway data
- `src/lib/state/gateway/gateway-data.svelte.ts` — Live agent presence data from WebSocket

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `characters.ts`: Full character FSM with walk/type states, BFS pathfinding integration, reading tool detection (READING_TOOLS set). Needs constant tuning per D-01/D-02/D-03/D-07.
- `gateway-pixel-bridge.ts`: Maps workshop FSM states → character isActive/currentTool. Needs enhancement for sub-agents (D-09), tool name passthrough (D-10).
- `matrix-effect.ts`: Complete matrix digital rain effect with configurable duration. Ready to wire into spawn/despawn.
- `office-state.ts`: Sub-agent tracking (subagentIdMap, subagentMeta, negative IDs) already stubbed.
- `sprite-data.ts`: CharacterSprites with palette support and hue shifting.
- `furniture-catalog.ts`: getCatalogEntry, getOnStateType, getAnimationFrames — CRT ON/OFF sprite variants exist.

### Established Patterns
- Character state updates happen in `updateCharacter()` called per-frame from game loop
- Gateway sync happens in `syncAgentState()` / `syncAgentList()` called from the update loop
- Bubble rendering uses `bubbleType` and `bubbleTimer` fields on Character
- Furniture ON states use `getOnStateType()` from furniture catalog

### Integration Points
- WorkshopCanvas.svelte initializes pixel office and starts game loop
- Game loop calls update(dt) → render(ctx) each frame
- Gateway bridge reads from `workshopState.agents` and `gw` (gateway presence)
- Agent FSM states are reactive via Svelte 5 `$state` (runed FiniteStateMachine)

</code_context>

<specifics>
## Specific Ideas

- Sub-agent characters should be visually distinct (smaller/translucent) to differentiate from parent agents
- Name labels should use a small pixel font consistent with the pixel art aesthetic
- CRT glow should be subtle — don't overpower the pixel art style
- Block-and-reroute collision means BFS pathfinding must include occupied tiles in its blocked set
- Initial load skips entrance walk for all already-connected agents — only new connections during runtime use the entrance spawn

</specifics>

<deferred>
## Deferred Ideas

- Click-to-select character (INTR-01) — Phase 9
- Mouse wheel zoom and pan (INTR-02, INTR-03) — Phase 9
- Status label showing current tool name (INTR-04) — Phase 9
- Character selection outline (INTR-05) — Phase 9
- Layout persistence (PERS-01 through PERS-04) — Phase 9
- PixiJS renderer migration — Phase 10
- Layout editor with furniture placement — Phase 11

</deferred>

---

*Phase: 08-character-animation-gateway-bridge*
*Context gathered: 2026-03-23*
