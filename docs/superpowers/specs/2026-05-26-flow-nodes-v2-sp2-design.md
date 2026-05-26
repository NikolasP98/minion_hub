# Flow Nodes v2 — SP-2: Trigger Nodes from Gateway Hooks

**Date:** 2026-05-26
**Status:** Approved — pending spec review
**Repos:** `minion_hub` (hub UI + DB) · `minion/` (gateway) · `langgraph-server` (flow runtime)
**Series:** SP-2 of 3 (SP-1: LLM + real-Agent nodes DONE · SP-3: plugin-contributed nodes)

---

## Problem

Flows currently only run when the user manually clicks "Test Run". This makes them useful for one-off queries but not for automation. SP-2 adds event-driven execution: a flow can subscribe to a gateway hook event and fire automatically when that event occurs (e.g. a Telegram message arrives, an agent finishes a turn, a memory node is updated).

---

## Goal

A new `trigger` node type defines the flow's entry point and subscribes to a specific gateway hook event. When the event fires, the gateway calls the flow runner; the result can optionally be delivered back to the originating channel session.

**Supported trigger events (MVP):**

| Event id | When it fires |
|---|---|
| `message:received` | Inbound message on any channel (before agent processes) |
| `message:sent` | Outbound reply delivered (after agent responds) |
| `agent:bootstrap` | Agent session initializes |
| `memory:node_created` | Knowledge-graph node inserted |
| `memory:node_updated` | Knowledge-graph node mutated |
| `memory:node_deleted` | Knowledge-graph node removed |

**Non-intercepting:** triggered flows fire asynchronously alongside normal gateway processing. The agent still runs normally. This avoids doubled replies and side-effects.

---

## Architecture

```
minion_hub (browser)                    minion gateway (in-process)
 ┌─────────────────────────┐            ┌─────────────────────────────────────┐
 │ Flow editor              │  RPC       │ flows.trigger.register/unregister   │
 │  Activate button ────────┼────────►  │ TriggerManager                      │
 │  Deactivate button       │            │  hook: message:received             │
 │  TriggerNode component   │            │  hook: message:sent                 │
 │                          │            │  hook: agent:bootstrap              │
 │ On gateway connect:      │            │  hook: memory:node_*                │
 │  re-register all active  │            │         │                           │
 │  trigger flows           │            │         ▼                           │
 └─────────────────────────┘            │   POST /flows/run-triggered ────────┼──►  langgraph-server
                                        │         │                           │         │
                                        │         ▼ (if deliverResponse=true) │         ▼
                                        │   chat.send { deliver: true }       │   compile flow
                                        │   → channel reply                   │   run graph
                                        └─────────────────────────────────────┘   return { reply }
```

---

## Data Model

### New `TriggerNodeData`

```ts
export type TriggerNodeData = {
  event: 'message:received' | 'message:sent' | 'agent:bootstrap'
        | 'memory:node_created' | 'memory:node_updated' | 'memory:node_deleted';
  label: string;
  deliverResponse: boolean;    // true = send flow output to originating channel; false = console only
  filterChannelId?: string;    // optional: only fire for a specific channel ('telegram', 'whatsapp', …)
  filterAgentId?: string;      // optional: only fire for a specific agent id
};
```

### `FlowNode.type` union

```ts
type FlowNodeType = 'agent' | 'promptBox' | 'llm' | 'trigger';  // trigger is new
```

### `flows` DB table additions

Two new columns (migration required — add with defaults to avoid breaking existing rows):
- `active` — `integer` (0/1 boolean, default 0) — whether this flow is armed to fire on events
- `config` — `text` JSON (default `'{}'`) — reserved for flow-level metadata; initially unused beyond activation state

### `validateFlowShape` extension

Accepts two valid flow shapes:
- **Manual:** exactly 1 `promptBox` + exactly 1 execution node (`llm` or `agent`) — unchanged from SP-1
- **Triggered:** exactly 1 `trigger` node + exactly 1 execution node (`llm` or `agent`)

No mixed shapes (trigger + promptBox together is invalid).

---

## Hub Changes (`minion_hub/`)

### 1. DB migration

Add the two new columns to the `flows` table with safe defaults. Run via `bun run db:push` (dev) and a Drizzle migration file for production.

```ts
// In packages/db or minion_hub/src/server/db/schema/flows.ts:
active: integer('active', { mode: 'boolean' }).notNull().default(false),
config: text('config').notNull().default('{}'),
```

### 2. API changes

`PUT /api/flows/[id]` — extend to accept and persist `active` (boolean) + `config` fields.

New endpoint: `GET /api/flows?active=true` — returns all flows where `active=true` with their `nodes` and `edges`. Used by the hub at gateway connect time to re-register active triggers.

### 3. `TriggerNode.svelte` (new component)

- Displays an event picker `<select>` (the 6 supported events with human-readable labels).
- A `deliverResponse` toggle (checkbox or pills: "Console only" / "Reply to channel").
- Optional filter fields: channel filter `<input>` and agent filter `<input>` (collapsed by default).
- One output handle on the right (`id: 'out'`, emerald). No input handle (it's the entry point).
- `onchange` writes `data.event`, `data.deliverResponse`, `data.filterChannelId`, `data.filterAgentId` via `setNodes`.
- `onclick` stop-propagation on interactive elements.

### 4. Activate/deactivate toolbar button

Added to `flow-editor/[id]/+page.svelte` toolbar, shown only when the flow contains a trigger node:
- Label: **Activate** / **Deactivate** based on flow's `active` flag.
- On Activate: `PUT /api/flows/[id]` with `{ active: true }` → then `sendRequest('flows.trigger.register', payload)`.
- On Deactivate: `PUT /api/flows/[id]` with `{ active: false }` → then `sendRequest('flows.trigger.unregister', { flowId })`.
- Disabled while the request is in-flight.

### 5. Re-registration on gateway connect

In `gateway.svelte.ts` (or the `onHelloOk` callback): after connecting, fetch all active trigger flows and re-register them with the gateway:

```ts
const res = await fetch('/api/flows?active=true');
const flows = await res.json();
for (const flow of flows) {
  const triggerNode = flow.nodes.find((n) => n.type === 'trigger');
  if (triggerNode) {
    await sendRequest('flows.trigger.register', {
      flowId: flow.id,
      event: triggerNode.data.event,
      deliverResponse: triggerNode.data.deliverResponse,
      filterChannelId: triggerNode.data.filterChannelId,
      filterAgentId: triggerNode.data.filterAgentId,
    });
  }
}
```

### 6. `FlowSidebar.svelte` palette

A **Trigger** item added at the top of the INPUTS section (above LLM and Prompt Box), with a distinct icon (e.g. `Zap` from lucide-svelte). Creates a `trigger` node with defaults (`event: 'message:received'`, `deliverResponse: false`).

### 7. `FlowCanvas.svelte`

- Adds `trigger: TriggerNode` to the `nodeTypes` map.
- Drop handler adds `trigger` branch.

### 8. `flow-editor.svelte.ts`

- Exports `TriggerNodeData`.
- Updates `FlowNode.type` union.
- Updates `FlowNode.data` union.

---

## Gateway Changes (`minion/`)

### New module: `src/flows/trigger-manager.ts`

Maintains the active trigger registry and manages hook subscriptions.

**Registry shape:**
```ts
type TriggerRegistration = {
  flowId: string;
  event: string;
  deliverResponse: boolean;
  filterChannelId?: string;
  filterAgentId?: string;
};
```

**`register(reg: TriggerRegistration)`:**
1. If already registered, unregister first (idempotent).
2. Call `registerInternalHook(reg.event, handler)` where `handler`:
   - Applies filters (channelId, agentId) — silently skips if they don't match.
   - Extracts `prompt` from the event context (see Event Payload Mapping below).
   - Calls `POST ${FLOWS_RUNNER_URL}/flows/run-triggered` with `{ flowId, prompt, eventPayload: event.context, sessionKey: event.sessionKey }`.
   - Awaits the response `{ reply: string }`.
   - If `deliverResponse=true` and the event has a non-empty `sessionKey`, calls `sessions.send { sessionKey, message: reply, deliver: true }` (or equivalent gateway API) to deliver the reply to the channel.

**`unregister(flowId: string)`:** removes the handler registrations for that flowId.

**`list()`:** returns all currently registered triggers.

### Event payload mapping (prompt extraction)

| Event | Extracted prompt |
|---|---|
| `message:received` | `event.context.content` (the inbound message text) |
| `message:sent` | `event.context.content` (the sent reply text) |
| `agent:bootstrap` | `"Agent ${event.context.agentId} bootstrapped for session ${event.sessionKey}"` |
| `memory:node_created` | `"New memory node: ${event.context.label} — ${JSON.stringify(event.context.data)}"` |
| `memory:node_updated` | `"Memory updated: ${event.context.label} — ${JSON.stringify(event.context.data)}"` |
| `memory:node_deleted` | `"Memory deleted: ${event.context.label}"` |

### New gateway RPC methods

Registered at startup (alongside existing RPC methods):

```ts
gateway.registerGatewayMethod('flows.trigger.register', async ({ params, respond }) => {
  triggerManager.register(params as TriggerRegistration);
  respond({ ok: true });
});

gateway.registerGatewayMethod('flows.trigger.unregister', async ({ params, respond }) => {
  triggerManager.unregister((params as { flowId: string }).flowId);
  respond({ ok: true });
});

gateway.registerGatewayMethod('flows.trigger.list', async ({ respond }) => {
  respond({ triggers: triggerManager.list() });
});
```

### New env var in gateway

```
FLOWS_RUNNER_URL=http://localhost:2025   # langgraph-server /flows/run-triggered
```

---

## langgraph-server Changes

### New endpoint `POST /flows/run-triggered`

Request body:
```ts
{
  flowId: string;
  prompt: string;
  eventPayload: Record<string, unknown>;  // raw event context (for future node use)
  sessionKey?: string;
}
```

Behavior:
1. Fetch `{ nodes, edges }` for `flowId` from `GET ${HUB_URL}/api/flows/${flowId}` (uses `HUB_API_TOKEN` Bearer auth).
2. Call `compileFlow(nodes, edges)` — compiles the trigger→exec chain (trigger node seeds the initial state from `prompt`).
3. Invoke the graph: `graph.invoke(initialState)`.
4. Extract the final assistant message: `result.messages.at(-1)?.content`.
5. Return `{ reply: string }` (JSON, not SSE — the gateway awaits the full result synchronously).
6. On error: return `{ error: string }` with HTTP 500. Gateway logs but does not crash.

**Not SSE** — unlike `POST /flows/run`, this endpoint returns JSON because the gateway's hook handler awaits the full result before optionally delivering it to a channel.

### `compileFlow` extension for trigger nodes

`validateFlowShape` accepts the triggered shape (1 trigger + 1 exec node). For compilation:
- The `trigger` node acts like a `promptBox` — its role is to seed `initialState.messages` with `HumanMessage(prompt)`.
- The trigger node's `data.event`, `data.deliverResponse`, etc. are available in the request body for context but are not used during graph compilation (the graph runs identically to a manual flow — just with a different initial message source).

### New env vars in `langgraph-server/.env`

```
HUB_URL=http://localhost:5173         # Hub SvelteKit server
HUB_API_TOKEN=                        # Bearer token for /api/flows/* (reuse GATEWAY_TOKEN or a dedicated token)
```

---

## Error Handling

| Scenario | Behavior |
|---|---|
| `flows.trigger.register` called for unknown flow | OK — gateway registers; if langgraph-server can't fetch the flow later, it logs the error and skips delivery |
| langgraph-server unreachable when trigger fires | Gateway hook handler catches the HTTP error, logs it, continues. Does NOT crash or block normal gateway processing. |
| `deliverResponse=true` but reply delivery fails | Log error; no retry. Flow output is lost but gateway continues. |
| Hub not reachable at langgraph-server startup | `run-triggered` returns 503 with `{ error: "Hub unreachable" }`. Gateway logs, skips delivery. |
| Trigger fires for a flow that was just deactivated | Race condition: gateway may still have the handler briefly. Extra fire is harmless — langgraph-server fetches the flow and runs it; the only side-effect is an extra response if `deliverResponse=true`. |
| trigger + promptBox in same flow | `validateFlowShape` rejects with `UnsupportedFlowError("A flow cannot have both a trigger and a prompt box.")` |

---

## Testing

**langgraph-server:**
- Unit: `validateFlowShape` accepts trigger + exec, rejects trigger + promptBox, rejects trigger + trigger.
- Unit: `compileFlow` with trigger node (injected model, seeds prompt correctly from request).
- Integration: `POST /flows/run-triggered` with a mocked hub API (responds with a known flow) → asserts the reply is returned.

**minion gateway:**
- Unit: `triggerManager.register` + `triggerManager.unregister` — assert correct hook registration count.
- Unit: event payload mapping functions — assert correct prompt extraction per event type.
- Integration: mock WS hub that calls `flows.trigger.register`, then simulate a `message:received` hook event, assert `POST /flows/run-triggered` is called with the right `prompt` and `flowId`.

**minion_hub:**
- Unit: `PUT /api/flows/[id]` persists `active` correctly.
- Unit: `GET /api/flows?active=true` returns only active flows.
- Manual: activate a trigger flow, send a test message on a connected channel, observe the flow running (console or channel reply depending on `deliverResponse`).

---

## Out of Scope (SP-3)

- Plugin-contributed trigger node types (e.g. WhatsApp "message:received" as a distinct node — SP-3).
- Trigger filters beyond channelId/agentId (e.g. message content regex, agent role).
- Fan-out: multiple active trigger flows subscribing to the same event (this works already — each calls run-triggered independently, but UI/UX for managing many is SP-3+).
- Retry on delivery failure.
- Trigger history / run log.

---

## Config Summary

| Key | Where | Purpose |
|---|---|---|
| `FLOWS_RUNNER_URL` | `minion/.env` (gateway) | langgraph-server `/flows/run-triggered` endpoint |
| `HUB_URL` | `langgraph-server/.env` | Hub SvelteKit server (to fetch flow JSON) |
| `HUB_API_TOKEN` | `langgraph-server/.env` | Bearer token for hub's `/api/flows/*` |
| `PUBLIC_LANGGRAPH_FLOWS_URL` | `minion_hub/.env` | Hub → langgraph-server (from MVP, unchanged) |
