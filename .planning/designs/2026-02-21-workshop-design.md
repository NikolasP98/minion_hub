# Workshop - Agent Interaction Canvas

**Date:** 2026-02-21
**Status:** Approved

## Overview

A new top-level route (`/workshop`) that provides a pannable, zoomable canvas where users can drag installed agent avatars from a toolbar, drop them onto the canvas to create instances, and visualize real-time agent interactions. The space simulates an "office" where minion avatars move around, interact with each other via real LLM conversations, and form teams connected by elastic relationship ropes.

## Core Technical Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Rendering | PixiJS 8 (WebGL 2D) | GPU-accelerated, handles 100+ sprites with complex animations |
| Physics | Rapier.js (WASM) | Fastest 2D physics, deterministic simulation, spring constraints for ropes |
| Rich UI | HTML overlay on PixiJS | Speech bubbles, menus, chat panels need DOM for text quality |
| Conversations | Real LLM via gateway | Agents have actual conversations routed through existing WebSocket gateway |

## Architecture

### Layer Stack (bottom to top)
1. **BgPattern** - existing theme-consistent background
2. **PixiJS canvas** - agents, ropes, visual effects, movement trails
3. **HTML overlay** - speech bubbles, toolbar, chat panels, context menus

### State
New `workshop.svelte.ts` store with Svelte 5 runes. Auto-saves to localStorage (debounced 300ms), named saves to SQLite.

## Canvas & Physics

### PixiJS Setup
- Single `Application` instance filling the route viewport
- Pan via pointer drag on empty space, zoom via scroll wheel (clamped 0.1x - 3x)
- Infinite canvas with subtle grid overlay (tiling sprite, moves with pan)
- Camera state tracked in workshop store for persistence

### Rapier Physics World
- Zero gravity (top-down 2D workspace)
- Each agent = kinematic rigid body with circle collider (kinematic during drag, dynamic on release with high damping)
- Agent-agent collision: soft repulsion, no wild bouncing
- Ropes: `ImpulseJointData.spring()` constraints between agent bodies

### Agent Sprites
- DiceBear SVG → Blob URL → PixiJS Texture
- Circular sprite with status-colored glow ring
- Name label as BitmapText (JetBrains Mono)
- Idle animation: sinusoidal bobbing (~2px)
- Talking animation: subtle pulse + ring animation

### Rope Rendering
- PixiJS `Graphics` redrawn each frame
- Catenary/quadratic bezier curve for slack feel
- Color from deterministic hash of freeform label
- Label text at rope midpoint, tooltip on hover (HTML overlay)

### Simulation Loop
- `requestAnimationFrame` drives Rapier `world.step()` + PixiJS render
- Fixed physics timestep (1/60s) with interpolation
- Sprite positions synced from Rapier body positions each frame

## Toolbar & Agent Placement

### Toolbar
- Fixed horizontal bar at top of Workshop view (below Topbar)
- Installed agents as circular avatar thumbnails
- Hover: tooltip with name + role
- Drag off toolbar → ghost preview sprite → drop on canvas to spawn instance
- Horizontal scroll for many agents

### Agent Context Menu (right-click)
- Remove from canvas
- Start conversation with... (nearby agents)
- Assign task
- View profile (links to existing agent detail)
- Change idle behavior (stationary / wander / patrol)

### Drag-to-Link
- Click-drag from agent to agent → dashed line follows cursor
- Drop on target → prompt for freeform relationship label
- Creates Rapier spring constraint + PixiJS rope graphic
- Click rope label → edit or delete

### Movement Behaviors
- **Stationary**: stays at placed position (kinematic body)
- **Wander**: slow drift within small radius of home position
- **Patrol**: moves between random points in user-defined area

## Conversation System

### Triggers
1. **User-initiated task**: Right-click canvas or "New Task" button → type prompt → select/nearby agents join
2. **Idle banter**: Connected idle agents within proximity → random timer (2-5 min) → short 2-3 message exchange

### Rules
- **Turn-based**: One agent speaks at a time per conversation
- **Proximity gate**: Must be within configurable distance to participate; dragged away = leaves conversation
- **Concurrency limit**: Max N simultaneous conversations (default 3), excess queued
- **Idle banter budget**: Global token/message budget per hour; exhausted = idle animations only
- **Priority**: User tasks > relationship banter > random proximity chat

### Visualization
- **Active conversation**: Rope glows/pulses, speech icon between agents
- **Speech bubbles**: Latest message as HTML overlay near sprite, auto-fade after 5s
- **Expandable panel**: Click conversation indicator → slide-out chat panel with full thread
- **Task cards**: Small card sprites on canvas near participants with progress indicator

### Gateway Integration
- Conversations route through existing WebSocket gateway
- Each workshop conversation = a session with workshop metadata
- Messages via existing `chat` state store, filtered by workshop session IDs

## State Model

```typescript
WorkshopState {
  camera: { x: number, y: number, zoom: number }

  agents: Map<instanceId, {
    agentId: string
    position: { x: number, y: number }
    behavior: 'stationary' | 'wander' | 'patrol'
    homePosition: { x: number, y: number }
  }>

  relationships: Map<relationshipId, {
    fromInstanceId: string
    toInstanceId: string
    label: string
  }>

  conversations: Map<conversationId, {
    type: 'task' | 'banter'
    participantInstanceIds: string[]
    sessionKey: string
    status: 'active' | 'completed' | 'queued'
  }>

  settings: {
    maxConcurrentConversations: number
    idleBanterEnabled: boolean
    idleBanterBudgetPerHour: number
    proximityRadius: number
  }
}
```

## Persistence

### Auto-save (localStorage)
- Debounced 300ms on state change
- Key: `workshop:autosave`
- Auto-restore on page load

### Named saves (SQLite)
- New `workshopSaves` table: `id`, `name`, `state` (JSON), `createdAt`, `updatedAt`
- API: `GET/POST/PUT/DELETE /api/workshop/saves`
- Save/Load UI in workshop toolbar

## New Dependencies

- `pixi.js` v8
- `@dimforge/rapier2d-compat`

## File Structure

```
src/routes/workshop/
  +page.svelte
  +page.ts

src/lib/components/workshop/
  WorkshopCanvas.svelte
  WorkshopToolbar.svelte
  AgentSprite.ts
  RopeRenderer.ts
  SpeechBubble.svelte
  ChatPanel.svelte
  TaskCard.svelte
  ContextMenu.svelte
  SaveLoadBar.svelte
  RelationshipPrompt.svelte

src/lib/workshop/
  physics.ts
  simulation.ts
  camera.ts
  conversation-manager.ts
  proximity.ts

src/lib/state/
  workshop.svelte.ts

src/routes/api/workshop/
  saves/+server.ts

src/server/db/schema/
  workshop.ts
```

### Topbar Update
Add "Workshop" nav item to existing `Topbar.svelte`.
