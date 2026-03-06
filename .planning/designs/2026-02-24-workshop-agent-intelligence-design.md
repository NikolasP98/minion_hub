# Workshop Agent Intelligence — Design Document

**Date:** 2026-02-24
**Status:** Approved

---

## Overview

Extends the workshop canvas with a cohesive intelligence layer: agents gain awareness of their environment, maintain structured short-term memory, prioritise reading new information over socialising, and can be monitored via a toggleable debug overlay. A new **Rulebook** element type lets users broadcast standing instructions to all agents. Agent chat messages are rendered as formatted markdown.

---

## Goals

1. Agents detect environment item changes and queue a "read" action
2. Per-agent action queue (typed, prioritised, capped at 5)
3. Context compaction via LLM summarisation + structured memory slots
4. Agents prioritise env-reading actions over agent-agent interaction
5. Agents always spawn above existing env elements
6. Agents periodically re-read env items to refresh stale context
7. Agent-to-agent information sharing gated by per-agent config flags
8. New **Rulebook** element — free-text, always prepended to every agent prompt
9. Markdown rendering in ConversationSidebar using carta-md
10. Debug overlay: action queue + FSM state + memory slots (toggleable)

---

## Architecture

```
WorkshopElement change
        │
        ▼
ElementChangeWatcher ($effect on workshopState.elements)
  snapshots { messageBoardContent, pinboardItems.length, inboxItems.length, rulebookContent }
        │
        ▼
AgentActionQueue  (new module: src/lib/workshop/agent-queue.ts)
  Map<instanceId, Action[]>
  typed actions: readElement | approachAgent | compactContext | seekInfo
  priority: compactContext > readElement(high) > readElement(normal) > seekInfo > approachAgent
        │
        ▼
simulation.ts tick()
  per-agent seekInfoTimer (90s) enqueues seekInfo for nearest stale element
  drains queue head when agent is idle or finishes wandering cycle
  dispatches to gateway-bridge or FSM directly
        │
        ▼
gateway-bridge.ts  getWorkshopContext()
  1. Rulebook "Standing Instructions" (always first)
  2. AgentMemory contextSummary (if present)
  3. workspaceNotes[] from [REMEMBER:] markers
  4. recentInteractions[]
  5. environmentState per element
  6. Existing pinboard / messageboard / inbox context
  (all filtered by agent config shareWorkspaceInfo / shareUserInfo flags)
        │
        ▼
ConversationSidebar
  <Markdown> component from carta-md replaces whitespace-pre-wrap
  Debug overlay (HTML, worldToScreen projected):
    FSM state badge | action queue list | memory slot summaries
```

---

## Action Queue

### Action Types

```ts
type AgentAction =
  | { type: 'readElement';    elementId: string; priority: 'high' | 'normal' }
  | { type: 'approachAgent';  targetInstanceId: string }
  | { type: 'compactContext' }
  | { type: 'seekInfo';       elementId: string }
```

### Queue Rules

| Rule | Detail |
|------|--------|
| Max depth | 5 per agent (`compactContext` always fits, bypasses cap) |
| Dedup | No two identical `{ type, elementId }` entries at once |
| Priority sort | `compactContext` → `readElement(high)` → `readElement(normal)` → `seekInfo` → `approachAgent` |
| Drain window | When FSM state is `idle` or agent just reached a wander target |

### Change Detection (`ElementChangeWatcher`)

- Svelte `$effect` watching `workshopState.elements`
- Snapshots `{ messageBoardContent, pinboardItems.length, inboxItems.length, rulebookContent }` per element
- On diff:
  - Rulebook change → `readElement(high)` for **all agents** + clear all `contextSummary` slots
  - Messageboard change → `readElement(high)` for all agents
  - Pinboard item added → `readElement(normal)` for all agents
  - Inbox item added → `readElement(high)` for matching agent only

### Periodic Info Seeking

- `seekInfoTimer` per agent in `simulation.ts` (90 s interval, separate from heartbeat)
- Enqueues `seekInfo` for the nearest element within 400 px that hasn't been re-read in 5 minutes
- "Last read" tracked in `AgentMemory.environmentState` timestamps

---

## Context Compaction & Memory Slots

### Trigger

- After **8 gateway turns** on a session key, OR
- Estimated token count > **6,000** (`sum(content.length) / 4`)

### Memory Structure

Stored in `agentMemory: Map<instanceId, AgentMemory>` (new export from `workshop.svelte.ts`, persisted in localStorage):

```ts
interface AgentMemory {
  contextSummary: string;                          // ≤400-token rolling summary
  workspaceNotes: string[];                        // from [REMEMBER:] markers, max 10
  recentInteractions: string[];                    // "talked to AgentX about Y", max 5
  environmentState: Record<string, {               // elementId → last-read info
    summary: string;
    lastReadAt: number;
  }>;
}
```

### Compaction Flow

1. `compactContext` drains from queue
2. Gateway call: *"Summarise your recent activity and key learnings in ≤400 tokens. Retain: workspace rules, unresolved tasks, agent relationships. Discard: pleasantries, resolved topics."*
3. Response saved to `contextSummary`
4. `conversationMessages` for session pruned to last **2 messages**
5. Next prompt prepends `contextSummary` before workshop context

### `[REMEMBER: ...]` Marker

- Scanned in `gateway-bridge.ts` alongside `[PIN:]` and `[SEND:]`
- Content appended to `workspaceNotes[]`, capped at 10 (oldest evicted)

---

## Agent Spawn Position

When an agent is dropped onto the canvas (drag-drop or programmatic `addAgentInstance`):

```ts
const elementsMinY = Math.min(...Object.values(workshopState.elements).map(e => e.position.y));
const spawnY = elements.length > 0
  ? Math.min(dropY, elementsMinY - 120)
  : dropY;
```

Applies in both `handleDrop` (WorkshopCanvas) and the direct `addAgentInstance` path.

---

## Content Filtering

Agent config (fetched from gateway) gains two boolean flags:

```ts
interface AgentConfig {
  // ...existing fields...
  shareWorkspaceInfo: boolean;  // default true — can share pinboard/messageboard content
  shareUserInfo: boolean;       // default false — user identity/session info
}
```

`getWorkshopContext()` checks these flags before injecting each context category. Flags are read from the gateway agent object and cached locally; missing flags default to `true/false` as above.

---

## Rulebook Element

### Data Shape

```ts
// Added to ElementType union
type ElementType = 'pinboard' | 'messageboard' | 'inbox' | 'rulebook';

// WorkshopElement gains:
rulebookContent?: string;
```

### Sprite

| Property | Value |
|----------|-------|
| Icon | 📖 |
| Background colour | `0x1a472a` (deep green) |
| Badge | None (content length indicator instead) |

### Prompt Injection

Prepended **first** in every agent prompt:

```
=== Standing Instructions ===
{rulebookContent}
=== End Standing Instructions ===
```

### UI

`RulebookOverlay.svelte` — same pattern as `MessageBoardOverlay`, textarea + save button.

---

## Markdown Rendering

Replace `whitespace-pre-wrap` text in `ConversationSidebar.svelte` with carta-md's `<Markdown>` component (render-only, no editor). Scoped CSS keeps styling consistent with the existing dark theme: tight line-height, `code` styled with `bg-bg1` background, headers downscaled to fit message bubbles.

---

## Debug Overlay

- Toggle button: bottom-left corner of WorkshopCanvas (hidden by default, persisted in localStorage)
- When enabled: per-agent floating panel positioned via `worldToScreen()` projection
- Panel contents:
  - **FSM state** badge (colour-coded)
  - **Action queue** — ordered list of pending actions
  - **Memory** — truncated `contextSummary`, `workspaceNotes` count, `environmentState` entries
- Auto-hides panels for agents outside the viewport

---

## Files to Create / Modify

| File | Change |
|------|--------|
| `src/lib/workshop/agent-queue.ts` | New — queue map, enqueue/dequeue/peek, priority sort |
| `src/lib/workshop/element-watcher.ts` | New — `$effect`-based change detector, calls enqueue |
| `src/lib/state/workshop.svelte.ts` | Add `agentMemory` map, `markAllInboxItemsRead`, rulebook type/helpers |
| `src/lib/workshop/simulation.ts` | `seekInfoTimer`, drain queue on idle windows, spawn-position fix |
| `src/lib/workshop/gateway-bridge.ts` | Memory injection, `[REMEMBER:]` scanning, config flag gating, compaction call, rulebook context |
| `src/lib/workshop/agent-fsm.ts` | Add `reading` FSM state (agent pauses movement to process an element) |
| `src/lib/workshop/element-sprite.ts` | Add `rulebook` type colours/icon |
| `src/lib/components/workshop/WorkshopCanvas.svelte` | Spawn-above logic, debug toggle, ElementChangeWatcher mount |
| `src/lib/components/workshop/ConversationSidebar.svelte` | carta-md `<Markdown>` rendering |
| `src/lib/components/workshop/RulebookOverlay.svelte` | New — textarea overlay for rulebook element |
| `src/lib/components/workshop/DebugOverlay.svelte` | New — per-agent debug panels |

---

## Non-Goals

- No server-side secret scanning (gateway config flags are the authority)
- No mdsvex preprocessor setup (carta-md handles runtime rendering)
- No persistent agent memory across host disconnects (clears on scene reset)
