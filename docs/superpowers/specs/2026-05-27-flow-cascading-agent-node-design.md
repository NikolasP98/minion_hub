# Flow Editor — Cascading "Agent" Node (Sub-feature A)

**Date:** 2026-05-27
**Status:** Approved — pending spec review
**Repos:** `minion_hub` (flow-editor UI + new endpoint) · `minion/` (new `drones.list` RPC) · `langgraph-server` (execution routing)
**Series:** Sub-feature **A** of 3 (B: built-in LangChain/LangGraph nodes · C: flows-as-configurable-plugin). A → B → C.

---

## Problem

The flow-editor sidebar lists every gateway agent and every built agent as its own draggable palette item ("Agents" + "Built Agents" sections). This doesn't scale, duplicates the agent list into the palette, and offers no way to pick a user's personal agent or a drone task. We replace the per-agent listing with **one** generic "Agent" node whose **cascading dropdowns** select an agent kind, then the specific instance.

---

## Goal

A single "Agent" palette item drops one agent node. The node has two cascading `<select>`s:

1. **Type** — `Custom agent` · `Personal agent` · `Drone task`
2. **Instance** — disabled until a type is chosen; its options depend on the type:
   - **Custom** → connected gateway agents (`gw.agents`) **plus** built agents (`builderState.agents`, `built:<id>` ids), labeled by display name.
   - **Personal** → personal agents of users in the current workspace/org, labeled by username.
   - **Drone** → registered drone tasks (id + description).

**Scope decisions (locked during brainstorming):**
- **Drone = picker now, execution follow-on.** The drone type is selectable and its options come from a new `drones.list` gateway RPC, but *running* a drone is a separate later sprint. In A, a drone-kind node that executes throws a clear "not yet supported" error.
- **Built agents fold into Custom, no back-compat.** Built agents appear in the Custom instance list. Existing saved flows with the previous `AgentNodeData` shape are **not** special-cased (the meta-repo has no production flows worth migrating).
- **Personal scope = workspace/org**, membership-gated (any authenticated org member can list their org's personal agents).

---

## Architecture

```
minion_hub (flow editor)
 ┌───────────────────────────────────────────────┐
 │ FlowSidebar: remove Agents + Built Agents       │
 │   sections; add ONE "Agent" palette item        │
 │ AgentNode.svelte: two cascading <select>s        │
 │   type → instance                                │
 │     custom   → gw.agents ∪ builderState.agents   │
 │     personal → GET /api/personal-agents?scope=org│──┐ (new hub endpoint, tenant-scoped)
 │     drone    → sendRequest('drones.list')        │──┼──► gateway RPC drones.list (NEW, listing only)
 └───────────────────────────────────────────────┘  │
                                                      ▼
                          langgraph-server compile-flow.ts
                            custom/personal → sendAgentTurn(agentId)   (existing path)
                            drone           → throw UnsupportedFlowError("coming soon")
```

---

## Data Model

### `AgentNodeData` (mirrored: `langgraph-server/src/flow/types.ts` + hub `flow-editor.svelte.ts`)

Add an `agentKind` discriminator. Keep existing fields (handles, sessionMode, etc.).

```ts
export type AgentNodeData = {
  agentKind: 'custom' | 'personal' | 'drone';
  agentId: string;        // gateway agent id | 'personal-<userId>' | drone id
  label: string;
  sessionMode: 'ephemeral' | 'shared';
  defaultValues?: Record<string, string>;
  contextRules?: unknown[];
  inputHandles?: HandleDef[];
  outputHandles?: HandleDef[];
  contextHandles?: HandleDef[];
};
```

A freshly-dropped node has `agentKind` unset (empty) and `agentId: ''` — both dropdowns start empty; instance dropdown is disabled until a type is picked.

**No back-compat:** SP-1's legacy `claude-*` agentId → LLM fallback in `resolveModelId` is unrelated and stays. Old saved nodes lacking `agentKind` are not migrated; selecting a type/instance fixes them.

---

## Hub Changes (`minion_hub/`, branch `dev`)

### 1. New endpoint: `GET /api/personal-agents?scope=org`

`src/routes/api/personal-agents/+server.ts` (new):
- `requireAuth(locals)` + `locals.tenantCtx` (401 if absent). Membership-scoped, not admin-only.
- Calls a new service `listOrgPersonalAgents(ctx)`.
- Returns `json({ personalAgents: [{ agentId: string, userName: string }] })`.

New service in `src/server/services/personal-agent.service.ts`:
```ts
export async function listOrgPersonalAgents(
  ctx: TenantContext,
): Promise<Array<{ agentId: string; userName: string }>> {
  // Join org users → personal_agents within the tenant.
  // Reuse the same tenant/member scoping that listUsers(ctx) uses, then
  // inner-join personal_agents on userId. Label = user.displayName ?? user.email.
}
```
(Implementer: mirror `listUsers(ctx)`'s tenant-member scoping, then join `personalAgents` on `userId`; only return users that have a personal agent. `agentId` is the stored `personalAgents.agentId`, i.e. `personal-<userId>`.)

### 2. New gateway RPC client call

The drone list is fetched client-side via the existing `sendRequest('drones.list', {})` (same path `LLMNode`/`FlowSidebar` use for `models.list`/`flows.nodes.list`).

### 3. `AgentNode.svelte` — cascading dropdowns

Rework the single agent `<select>` into two:
- **Type select**: options Custom / Personal / Drone. `onchange` sets `data.agentKind`, clears `data.agentId` + `data.label`.
- **Instance select**: `disabled` when no `agentKind`. Options sourced per kind:
  - custom: `[...gw.agents, ...builderState.agents]` (built ids prefixed `built:`), `agentDisplayName` / built `.name` as label.
  - personal: fetched on demand (when type === 'personal', or on mount) from `/api/personal-agents?scope=org`; option value = `agentId`, label = `userName`.
  - drone: fetched from `sendRequest('drones.list', {})`; option value = drone `id`, label = `description` (fallback `id`). Show a small "execution coming soon" hint when a drone is selected.
- `onchange` of instance sets `data.agentId` + `data.label`.
- Keep the session-mode toggle and the handles exactly as today.
- Fetching: load personal + drone lists lazily (on first switch to that type) via `$state` + `onMount`/an effect, mirroring `LLMNode`'s `models.list` fetch with try/catch fallback to `[]`.

### 4. `FlowSidebar.svelte` — palette

- **Delete** the "Agents" section (the `gw.agents` loop) and the "Built Agents" section (`builderState.agents` loop), in BOTH the expanded and collapsed views.
- **Add** a single "Agent" item in the Inputs/nodes area (Bot icon, indigo) that drops an agent node with `agentKind` unset (`addAgentNode()` with no preselected id). Drag payload `{ type: 'agent' }` (no `agentId`).
- `loadBuiltAgents()` stays (built agents still feed the Custom dropdown inside the node).

### 5. `FlowCanvas.svelte` — drop handler

The `agent` drop branch creates a node with empty `agentKind`/`agentId` (the node's dropdowns fill them), instead of requiring `payload.agentId`:
```ts
} else if (payload.type === 'agent') {
  const node: FlowNode = {
    id: makeId(), type: 'agent', position,
    data: {
      agentKind: '' as AgentNodeData['agentKind'], agentId: '', label: 'Agent',
      sessionMode: 'ephemeral', defaultValues: {}, contextRules: [],
      inputHandles: [{ id: 'in', label: 'input' }],
      outputHandles: [{ id: 'out', label: 'output' }],
      contextHandles: [{ id: 'ctx', label: 'context' }],
    },
  };
  setNodes([...flowEditorState.nodes, node]);
}
```
(The old `agent`-with-`agentId` drop path from the per-agent palette items is removed along with those palette items.)

### 6. State types (`flow-editor.svelte.ts`)

Add `agentKind` to `AgentNodeData` (mirror langgraph). `agentKind` type allows `'custom' | 'personal' | 'drone'`; the dropped-but-unset state uses an empty string cast at the drop site (kept out of the published type).

---

## Gateway Changes (`minion/`, branch `DEV`)

### 1. Drone registry: `src/drones/registry.ts` (new)

Export the available drones' metadata (currently just `summarize`):
```ts
export type DroneMeta = { id: string; description: string };
export const DRONES: DroneMeta[] = [
  { id: 'summarize', description: 'Summarize a conversation transcript' },
];
```
(Pull `id`/`description` from the existing `summarizeConversationDrone` definition where available; hardcoding the one entry is acceptable for A. This registry is the single source the `drones.list` RPC reads — and the seam the later drone-execution sprint extends.)

### 2. New RPC: `src/gateway/server-methods/drones.ts` (new)

```ts
export function createDronesHandlers(): GatewayRequestHandlers {
  return {
    "drones.list": ({ respond }) => respond(true, { drones: DRONES }),
  };
}
```
Spread into `extraHandlers` in `src/gateway/server.impl.ts` alongside `createFlowsNodesHandlers()`. Not admin-gated (matches `flows.nodes.list`).

**A adds listing only** — no `drones.invoke`. That is the follow-on sprint.

---

## langgraph-server Changes (meta-repo, branch `dev`)

### `src/flow/types.ts`

Add `agentKind: 'custom' | 'personal' | 'drone'` to `AgentNodeData` (mirror hub).

### `src/flow/compile-flow.ts` — `buildExecNode` agent branch

The existing real-`agent` branch (gateway-agent path via `sendAgentTurn`) handles `custom` and `personal` unchanged — both resolve to a gateway `agentId` (`personal-<userId>` is a real gateway agent). Add a guard at the top of the agent branch:
```ts
const agentData = node.data as AgentNodeData;
if (agentData.agentKind === 'drone') {
  throw new UnsupportedFlowError('Drone execution is not yet supported — coming soon.');
}
```
(Place this so it throws at compile time for drone-kind agent nodes. Custom/personal fall through to the existing `sendAgentTurn` dispatch. The SP-1 legacy `claude-*` → LLM fallback stays as-is.)

---

## Error Handling

| Scenario | Behavior |
|---|---|
| `/api/personal-agents?scope=org` with no tenantCtx | 401 (route guard). |
| Org has no personal agents | Returns `{ personalAgents: [] }`; instance dropdown shows an empty/"none" state. |
| `drones.list` RPC unavailable (gateway offline) | Client catch → `[]`; drone instance dropdown empty. Mirrors `models.list` fallback. |
| Drone-kind node executed | `compileFlow` throws `UnsupportedFlowError("Drone execution is not yet supported — coming soon.")`; the run console shows it. |
| Custom/personal node with empty `agentId` (type chosen, instance not) | `validateFlowShape` is unchanged; `sendAgentTurn('')` would fail at run — acceptable (user must pick an instance). Optionally the node UI disables Run until instance set — out of scope for A. |
| Built agent selected (`built:<id>`) | Routed as a gateway agent id, same as today. |

---

## Testing

**Hub (`minion_hub`, `bun run test` / `bun run check`):**
- Unit: `listOrgPersonalAgents(ctx)` returns `[{agentId, userName}]` for org members with personal agents (mock the DB/ctx the way existing service tests do).
- Unit: `GET /api/personal-agents?scope=org` returns the list; 401 without tenantCtx.
- The cascading select behavior (type unblocks instance; instance options per kind) is validated via `bun run check` + Svelte autofixer + manual verification (no DnD/SSR unit harness for the node component).

**Gateway (`minion/`, `pnpm test`):**
- Unit: `drones.list` handler returns `{ drones: DRONES }`.

**langgraph-server (`npm test`):**
- Unit: `compileFlow` with an `agent` node `agentKind:'custom'` (or `'personal'`) routes to the injected `sendAgentTurn`; `agentKind:'drone'` throws `UnsupportedFlowError`.

**Manual E2E:** open flow editor → drag the single "Agent" node → Type=Custom lists gw+built agents; Type=Personal lists org users' personal agents by name; Type=Drone lists `summarize` with a "coming soon" hint. Run a promptBox→(custom agent) flow → reply. Run a drone-kind flow → clear "not yet supported" error.

---

## Out of Scope (later sub-features / follow-ons)

- **Drone execution** (`drones.invoke` buffer-to-final RPC + langgraph routing + per-drone arg mapping + streaming) — follow-on after A.
- **B: built-in LangChain/LangGraph nodes** (chain/graph primitives).
- **C: flows-as-configurable-plugin in settings/plugins.**
- Migration of old saved agent-node data (explicitly no back-compat).
- Disabling Run until an instance is selected (nice-to-have, not required).
- Per-drone input configuration UI.

---

## Config Summary

No new env vars. Reuses the existing gateway WS (`GATEWAY_TOKEN`), the hub→gateway `sendRequest` client, and `PUBLIC_LANGGRAPH_FLOWS_URL`.
