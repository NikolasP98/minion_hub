# Subagents Tab Design

## Overview

Add a "Subagents" tab to the agent detail view in Minion Hub, showing the full history of subagent sessions spawned by each agent with a split-panel layout: subagent list (left) + detail (right).

## Context

The Minion gateway has a mature subagent framework (`src/agents/subagents/`) supporting spawn, registry, announce, depth tracking, and parallel fanout. The gateway protocol already exposes all necessary data:

- `sessions.list` with `spawnedBy` filter returns child sessions
- Session metadata includes `spawnDepth`, `spawnedBy`, `model`, `status`, `label`
- `chat.history` works for any session key including subagent sessions
- WebSocket session events broadcast subagent lifecycle changes

**No gateway code changes required.**

## Data Layer

### State: `subagent-data.svelte.ts`

Reactive store holding subagent list for the currently selected agent.

**Exports:**
- `subagents` — filtered session list (all statuses: running, completed, failed, archived)
- `selectedSubagent` — currently selected subagent session
- `loading` — loading state

**Lifecycle (hybrid real-time):**
1. Tab activates: calls `sessions.list({ agentId, spawnedBy: "agent:<id>:*" })`
2. Populates list, starts filtering existing WS session events for keys matching `agent:<id>:subagent:*`
3. Incoming events upsert into list; if selected subagent updates, refresh detail
4. Tab deactivates: stops filtering, clears selection and list

**Sorting:** Running subagents pinned to top, then `startedAt` descending (full history visible).

## UI Layout

### Split Panel

```
+-------------------------+--------------------------------------+
|  Subagent List          |  Subagent Detail                     |
|                         |                                      |
|  +-------------------+  |  +------------------------------+   |
|  | [status] label    |<-|->| Chat  | Monitor | Meta       |   |
|  | model             |  |  +------------------------------+   |
|  | depth 1 - 2m 34s  |  |  |                              |   |
|  | 1,240 tokens      |  |  |  (reuses SessionViewer /     |   |
|  +-------------------+  |  |   SessionMonitor components) |   |
|  +-------------------+  |  |                              |   |
|  | [status] label    |  |  |                              |   |
|  | model             |  |  |                              |   |
|  | depth 1 - running |  |  |                              |   |
|  +-------------------+  |  +------------------------------+   |
|                         |                                      |
|  -- View -----------    |                                      |
|  [* List] [ Tree]       |                                      |
|  [ Timeline]            |                                      |
|  (coming soon badges)   |                                      |
+-------------------------+--------------------------------------+
```

### Subagent Card Fields

- Status indicator (green=completed, yellow=running, red=failed, gray=archived)
- Label (from `sessions_spawn` label param)
- Model used
- Depth badge (depth 1, depth 2)
- Duration (or "running" with elapsed time)
- Token usage (input/output if available in metadata)
- Spawned timestamp
- Parent label (for depth-2 subagents, shows which orchestrator spawned them)

### Detail Panel Sub-tabs

- **Chat** — reuses `SessionViewer` with the subagent's session key
- **Monitor** — reuses `SessionMonitor` showing tool call timeline
- **Meta** — raw session metadata: model, config, spawn params, announce status

### View Switcher

Bottom of left panel. Three options:
- **List** (active, default) — flat list with rich cards
- **Tree** (coming soon) — nested tree showing parent-child-grandchild relationships with status dots, labels, models per node
- **Timeline** (coming soon) — horizontal swimlane showing spawn/complete times per depth level, visualizing concurrency

### Empty State

When no subagents exist: centered message explaining what subagents are and that `maxSpawnDepth >= 1` is needed in gateway config.

## Component Breakdown

### New Files

| File | Purpose |
|------|---------|
| `SubagentsTab.svelte` | Top-level tab container, split panel, lifecycle |
| `SubagentList.svelte` | Left panel — list of subagent cards with sorting |
| `SubagentCard.svelte` | Individual card with all metadata fields |
| `SubagentDetail.svelte` | Right panel — Chat/Monitor/Meta sub-tabs |
| `SubagentMeta.svelte` | Meta sub-tab — raw metadata display |
| `SubagentEmptyState.svelte` | Empty state message |
| `ViewSwitcher.svelte` | List/Tree/Timeline toggle with coming-soon badges |
| `subagent-data.svelte.ts` | Reactive store for data fetching and WS subscription |

### Modified Files

| File | Change |
|------|--------|
| `AgentDetail.svelte` | Add "Subagents" tab to tab bar |
| `ui.svelte.ts` | Add `"subagents"` to `activeAgentTab` type |

### Reused Components

- `SessionViewer` — Chat sub-tab content
- `SessionMonitor` — Monitor sub-tab content

## Real-time Subscription Flow

```
User opens Subagents tab
  -> store activates
  -> sessions.list({ agentId, spawnedBy: "agent:<id>:*" })
  -> populate list
  -> filter incoming WS session events for "agent:<id>:subagent:*"

Session event arrives
  -> upsert into list
  -> refresh detail if selected subagent changed

User selects subagent
  -> chat.history({ sessionKey: subagentKey })
  -> load into SessionViewer / SessionMonitor

User leaves tab or switches agent
  -> store deactivates
  -> stop filtering events
  -> clear selection and list
```

## Future: View Modes (Coming Soon)

### Tree Visualization
Nested tree showing parent-child-grandchild hierarchy. Each node: status dot, label, model. Click to select. Directly maps to depth-2 orchestrator patterns where main agent spawns orchestrators that spawn specialists.

### Timeline/Swimlane
Horizontal timeline with lanes per depth level. Shows spawn and completion times. Overlapping bars visualize concurrent execution. Useful for performance analysis and understanding fanout patterns.

Both documented in view switcher with "coming soon" badges and tooltips.
