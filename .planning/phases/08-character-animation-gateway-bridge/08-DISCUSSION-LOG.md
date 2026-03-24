# Phase 8: Character Animation + Gateway Bridge - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-03-23
**Phase:** 08-character-animation-gateway-bridge
**Areas discussed:** Animation timing & feel, Gateway-to-pixel mapping, Spawn/despawn behavior, CRT monitor & bubbles, Multi-agent collision, Initial load behavior, Character sprite source

---

## Animation Timing & Feel

### Walk Speed

| Option | Description | Selected |
|--------|-------------|----------|
| Leisurely stroll (48px/sec) | ~3 tiles/sec. Calm office vibe. | |
| Brisk walk (64px/sec) | ~4 tiles/sec. More purposeful movement. | ✓ |
| You decide | Claude picks based on testing. | |

**User's choice:** Brisk walk (64px/sec)

### Idle Wander Frequency

| Option | Description | Selected |
|--------|-------------|----------|
| Frequent (2-10s pauses) | Lively office feel. | |
| Occasional (10-30s pauses) | Characters mostly sit. Current code: 2-20s. | |
| Rare (30-60s pauses) | Very chill office. Characters almost always at desk. | ✓ |

**User's choice:** Rare (30-60s pauses)

### Return-to-Seat Urgency

| Option | Description | Selected |
|--------|-------------|----------|
| Walk back naturally | Normal speed pathfind to seat. | |
| Teleport instantly | Snap to seat immediately. | |
| Fast walk (2x speed) | Rush back at double speed. | ✓ |

**User's choice:** Fast walk (2x speed)

### Typing vs Reading Distinction

| Option | Description | Selected |
|--------|-------------|----------|
| Same animation, different speed | Both bob/shift, typing fast, reading slow. | |
| Distinct poses | Different sprite frames per state. | |
| You decide | Claude picks with existing sprites. | ✓ |

**User's choice:** You decide

### Walk Animation Frames

| Option | Description | Selected |
|--------|-------------|----------|
| 4 directions, 4 frames each | Full directional animation (16 frames). | ✓ |
| 2 directions + mirror | Down + side with mirroring. 8 frames. | |
| You decide | Claude inspects sprite data. | |

**User's choice:** 4 directions, 4 frames each

### Character Palette Diversity

| Option | Description | Selected |
|--------|-------------|----------|
| Deterministic from agent ID | Same agent = same color always. | ✓ |
| Random on each spawn | Variety but inconsistent. | |
| User-assigned colors | Pull from agent config if available. | |

**User's choice:** Deterministic from agent ID

### Wander Range

| Option | Description | Selected |
|--------|-------------|----------|
| Nearby (3-5 tiles) | Stay near desk area. | |
| Full office | Wander anywhere walkable. | ✓ |
| You decide | Claude picks a default. | |

**User's choice:** Full office

### Seat Rest Duration

| Option | Description | Selected |
|--------|-------------|----------|
| Short cooldown (5-15s) | Characters get up quickly. | ✓ |
| Medium cooldown (30-60s) | Rest at desk for a while. | |
| Long cooldown (2-4 min) | Stay seated long. Current: 2-4 min. | |
| You decide | Claude picks based on testing. | |

**User's choice:** Short cooldown (5-15s)

---

## Gateway-to-Pixel Mapping

### Cooldown State Behavior

| Option | Description | Selected |
|--------|-------------|----------|
| Stay seated, stop typing | Simple idle pose at desk. | |
| Stay seated, slow bob | Subtle idle animation. | |
| You decide | Claude picks what looks natural. | ✓ |

**User's choice:** You decide

### Sub-agent Visualization

| Option | Description | Selected |
|--------|-------------|----------|
| No sub-agent characters | Only top-level agents get characters. | |
| Temporary sub-agent character | Smaller/translucent character near parent. | ✓ |
| Defer to Phase 9+ | Skip sub-agent visuals entirely. | |

**User's choice:** Temporary sub-agent character

### Heartbeat State

| Option | Description | Selected |
|--------|-------------|----------|
| Brief visual pulse | Character sprite briefly glows. | |
| No pixel reaction | Heartbeat is classic/habbo concept only. | |
| You decide | Claude picks for pixel art. | ✓ |

**User's choice:** You decide

### Tool Granularity

| Option | Description | Selected |
|--------|-------------|----------|
| Use gateway presence tool names | Read actual tool name from presence data. | |
| Use FSM states only | Map conversing→typing, reading→reading. | |
| Both with fallback | Prefer tool name, fall back to FSM. | ✓ |

**User's choice:** Both with fallback

### Dragged State

| Option | Description | Selected |
|--------|-------------|----------|
| No drag in pixel office | Click-to-select only. | |
| Drag to reassign seat | User drags character to different desk. | ✓ |
| Defer to Phase 11 (editor) | Drag belongs in layout editor. | |

**User's choice:** Drag to reassign seat

### Agent Name Labels

| Option | Description | Selected |
|--------|-------------|----------|
| Always visible | Small pixel-font name above each character. | ✓ |
| On hover/select only | Clean default, name on interaction. | |
| Defer to Phase 9 | Status labels are Phase 9 requirement. | |

**User's choice:** Always visible

---

## Spawn/Despawn Behavior

### Spawn Location

| Option | Description | Selected |
|--------|-------------|----------|
| At their assigned seat | Materialize at desk. | |
| At office entrance, walk to seat | Spawn at door tile, walk to desk. | ✓ |
| Random walkable tile, walk to seat | Appear randomly, pathfind to seat. | |

**User's choice:** At office entrance, walk to seat

### Office Entrance Tile

| Option | Description | Selected |
|--------|-------------|----------|
| Bottom center | Designated tile at bottom-center. | |
| Top-left corner | Classic entrance at top-left. | |
| Auto-detect from layout | First walkable edge tile. | ✓ |

**User's choice:** Auto-detect from layout

### Despawn Behavior

| Option | Description | Selected |
|--------|-------------|----------|
| Matrix effect at current position | Dissolve with digital rain wherever they are. | ✓ |
| Walk to entrance, then despawn | Walk back to entrance first. | |
| Fade out in place | Simple alpha fade. | |

**User's choice:** Matrix effect at current position

### Seat Assignment on Spawn

| Option | Description | Selected |
|--------|-------------|----------|
| First available seat | First unoccupied seat in order. | ✓ |
| Deterministic by agent ID | Hash agent ID to seat index. | |
| You decide | Claude picks based on existing code. | |

**User's choice:** First available seat

---

## CRT Monitor & Bubbles

### CRT Monitor ON State

| Option | Description | Selected |
|--------|-------------|----------|
| Sprite swap only | Swap to ON sprite, no extra effects. | |
| Sprite swap + subtle glow | ON sprite plus small glow effect. | ✓ |
| You decide | Claude picks for Canvas 2D. | |

**User's choice:** Sprite swap + subtle glow

### Permission Bubble Style

| Option | Description | Selected |
|--------|-------------|----------|
| Pixel speech bubble with dots | Classic retro bubble with amber •••. | ✓ |
| Floating amber icon | Minimal amber circle/triangle icon. | |
| You decide | Claude picks for pixel art. | |

**User's choice:** Pixel speech bubble with dots

### Waiting/Done Bubble Duration

| Option | Description | Selected |
|--------|-------------|----------|
| Brief flash (2-3s) | Quick acknowledgment. | ✓ |
| Persistent until next activity | Stays until new conversation/wander. | |
| You decide | Claude picks a duration. | |

**User's choice:** Brief flash (2-3s)

### Bubble Data Source

| Option | Description | Selected |
|--------|-------------|----------|
| Gateway presence data only | Bridge reads presence.status. | |
| FSM transitions + gateway | Local FSM tracks, gateway confirms. | |
| You decide | Claude picks simplest approach. | ✓ |

**User's choice:** You decide

---

## Multi-agent Collision

| Option | Description | Selected |
|--------|-------------|----------|
| Pass through each other | Characters overlap on shared tiles. | |
| Block and reroute | Characters treat others as blocked tiles. | ✓ |
| You decide | Claude picks for BFS pathfinding. | |

**User's choice:** Block and reroute

---

## Initial Load Behavior

| Option | Description | Selected |
|--------|-------------|----------|
| Staggered spawn (0.2s apart) | Each agent spawns with matrix effect, delays between. | |
| All at once at seats | All agents appear seated immediately. | ✓ |
| All spawn at entrance simultaneously | Everyone appears and walks to seats. | |

**User's choice:** All at once at seats

---

## Character Sprite Source

| Option | Description | Selected |
|--------|-------------|----------|
| Use existing sprites as-is | Work with current CharacterSprites. Duplicate/mirror if needed. | ✓ |
| Create new 4-frame sprites | Design new pixel art walk frames. | |
| You decide after inspecting | Claude inspects sprite-data.ts first. | |

**User's choice:** Use existing sprites as-is

---

## Claude's Discretion

- Typing vs reading animation visual distinction
- Cooldown state character behavior
- Heartbeat state pixel reaction
- Bubble data source approach
- CRT glow color and intensity

## Deferred Ideas

- Click-to-select, pan/zoom, status labels, selection outline — Phase 9
- Layout persistence — Phase 9
- PixiJS migration — Phase 10
- Layout editor — Phase 11
