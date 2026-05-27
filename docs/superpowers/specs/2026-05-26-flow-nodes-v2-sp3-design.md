# Flow Nodes v2 — SP-3: Plugin-Contributed Flow Nodes

**Date:** 2026-05-26
**Status:** Approved — pending spec review
**Repos:** `minion/` (gateway) · `langgraph-server` (flow runtime) · `minion_hub` (hub UI)
**Series:** SP-3 of 3 (SP-1: LLM + real-Agent nodes DONE · SP-2: trigger nodes from gateway hooks DONE)

---

## Problem

The flow editor's node palette is hard-coded: `promptBox`, `llm`, `agent`, `trigger`. A gateway plugin (e.g. WhatsApp, Telegram) cannot surface its own flow building-blocks — a "WhatsApp message received" trigger, or a "Send WhatsApp message" action. Every new capability requires editing the hub's source. SP-3 lets an installed plugin **declare** flow nodes in its `minion.plugin.json`; the gateway exposes them over RPC; the hub palette renders them dynamically; and the flow runtime executes them by calling back into the gateway.

---

## Goal

A plugin declares `flowNodes` in its manifest. Each contribution is one of two kinds:

- **`trigger`** — an entry node that subscribes to a gateway hook event the plugin emits. Reuses the SP-2 trigger/execution path entirely.
- **`action`** — an execution node whose work is a gateway RPC method the plugin registers via `api.registerGatewayMethod(...)`. The flow runtime invokes it with the upstream prompt and uses the string reply as the node's output.

Plugin nodes are **declarative descriptors (data, not code)**. The hub renders them with a single generic component — it never loads plugin JavaScript. This matches the existing iframe-sandboxed plugin-UI boundary and keeps `@xyflow` node registration static.

**MVP shape (this sprint):** a flow is still **one entry node → one execution node**. Plugin nodes are new variants of those two roles:

| Role | Built-in types (existing) | New plugin type |
|---|---|---|
| Entry | `promptBox`, `trigger` | `pluginTrigger` |
| Exec | `llm`, `agent` | `pluginAction` |

Multi-node chains remain out of scope (SP-4).

---

## Architecture

```
Plugin (minion.plugin.json)                         minion gateway (in-process)
 ┌────────────────────────────────┐                 ┌──────────────────────────────────────────┐
 │ flowNodes: [                    │   manifest      │ flows.nodes.list  ── reads registry ──────┐│
 │   { id, kind:'trigger',         │  ───────────►   │   plugins' manifests → descriptors        ││
 │     event, label, icon },       │                 │                                            ││
 │   { id, kind:'action',          │                 │ pluginTrigger event → SP-2 TriggerManager  ││
 │     method, label, icon }       │                 │   (dynamic hook subscription)              ││
 │ ]                               │                 │                                            ││
 │ register(api):                  │                 │ pluginAction method → registerGatewayMethod││
 │   api.registerGatewayMethod(    │                 │   handler (plugin-supplied)                ││
 │     method, handler)            │                 └──────────────┬─────────────────────────────┘
 └────────────────────────────────┘                                │
                                                                    │ flows.nodes.list (RPC)
 minion_hub (browser)                                               ▼
 ┌──────────────────────────────────────────────┐   RPC    ┌───────────────────┐
 │ FlowSidebar: "Plugin nodes" palette section   │ ◄────────┤ descriptors        │
 │   grouped by plugin (fetched on mount)         │          └───────────────────┘
 │ Generic PluginNode.svelte renders descriptor  │
 │ Drop → FlowNode {type:'pluginTrigger'|         │
 │        'pluginAction', data:{pluginId,...}}    │
 │ Activate (pluginTrigger) → SP-2 register path  │
 └───────────────────────────────┬────────────────┘
                                 │ run / triggered
                                 ▼
                       langgraph-server compileFlow
                         • pluginTrigger = entry (uses initialPrompt, SP-2)
                         • pluginAction  = exec → gatewayClient.callGatewayMethod(method, {input})
                                                   │
                                                   ▼  gateway routes to plugin handler → { reply }
```

---

## Data Model

### Manifest contribution: `FlowNodeContribution` (gateway)

Declared in `minion.plugin.json` under a new top-level `flowNodes` array. Two kinds share a common base:

```ts
type FlowNodeContributionBase = {
  id: string;            // unique within the plugin, e.g. "message-received"
  label: string;         // human-readable palette label
  description?: string;
  icon?: string;         // Phosphor icon name (same convention as ui[].icon)
};

type FlowTriggerContribution = FlowNodeContributionBase & {
  kind: 'trigger';
  event: string;         // gateway hook event key the plugin emits (e.g. "whatsapp:message")
};

type FlowActionContribution = FlowNodeContributionBase & {
  kind: 'action';
  method: string;        // gateway RPC method the plugin registers (e.g. "whatsapp.flow.send")
};

type FlowNodeContribution = FlowTriggerContribution | FlowActionContribution;
```

`PluginManifest` (`src/plugins/manifest.ts`) gains `flowNodes?: FlowNodeContribution[]`. The manifest loader parses & validates it (mirroring how `ui[]` is parsed: skip malformed entries, keep valid ones).

### RPC `flows.nodes.list` return shape

```ts
type FlowNodeDescriptor = FlowNodeContribution & { pluginId: string };
// response: { nodes: FlowNodeDescriptor[] }
```

Includes nodes from **all loaded, enabled** plugins (matching `plugins.ui.list` semantics: read the registry, skip disabled).

### langgraph-server / hub node data types

```ts
// langgraph-server: src/flow/types.ts  &  hub: flow-editor.svelte.ts (kept in sync, as SP-1/SP-2 did)
export type PluginTriggerNodeData = {
  pluginId: string;
  contributionId: string;   // FlowNodeContribution.id
  event: string;
  label: string;
  deliverResponse: boolean;
};

export type PluginActionNodeData = {
  pluginId: string;
  contributionId: string;
  method: string;
  label: string;
};

// FlowNode.type union gains:  'pluginTrigger' | 'pluginAction'
```

`config`/parameter fields on plugin nodes are **out of scope for this MVP** — descriptors carry no config schema, and node data carries no opaque config. (Deferred; see Out of Scope.)

### `validateFlowShape` extension (langgraph-server)

Entry nodes: `promptBox` | `trigger` | `pluginTrigger`.
Exec nodes: `agent` | `llm` | `pluginAction`.
Still exactly **one entry + one exec**, connected by a `flow` edge. All existing rejection rules unchanged (no two entries, no two execs, no trigger+promptBox mix; a `pluginTrigger` counts as a trigger for the "no prompt+trigger" rule).

---

## Gateway Changes (`minion/`, branch `DEV`)

### 1. Manifest type + parser

- `src/plugins/types.ts`: add `FlowNodeContribution` (and its two variants) + re-export.
- `src/plugins/manifest.ts`: add `flowNodes?` to `PluginManifest`; parse in `loadPluginManifest` (validate `id`, `kind ∈ {trigger,action}`, `label`; require `event` for triggers and `method` for actions; skip malformed entries).

### 2. New RPC handler: `src/gateway/server-methods/flows-nodes.ts`

`createFlowsNodesHandlers(): GatewayRequestHandlers` exposing `flows.nodes.list`. Mirrors `pluginsHandlers["plugins.ui.list"]`:

```ts
export function createFlowsNodesHandlers(): GatewayRequestHandlers {
  return {
    "flows.nodes.list": ({ respond }) => {
      try {
        const registry = loadRegistry();            // same helper plugins.ts uses
        const nodes = collectFlowNodeDescriptors(registry);  // flatten manifests → FlowNodeDescriptor[]
        respond(true, { nodes });
      } catch (err) {
        respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String((err as Error).message ?? err)));
      }
    },
  };
}
```

`collectFlowNodeDescriptors` iterates `registry.plugins` (enabled only), reads each plugin's manifest `flowNodes`, stamps `pluginId`. Unlike `plugins.ui.list`, this is **not admin-gated** — the flow editor is already an authenticated surface and node descriptors carry no secrets. (Confirm against existing flow RPCs; `flows.trigger.*` are not admin-gated either.)

Spread into `extraHandlers` in `src/gateway/server.impl.ts` alongside `createFlowsTriggerHandlers()`.

### 3. Trigger-manager: accept plugin-declared events

`src/flows/trigger-manager.ts` currently subscribes to a fixed `SUPPORTED_EVENTS` array and `extractPrompt` switches on a closed `TriggerEventKey` union.

- Widen `TriggerEventKey` to `string` (keep the 6 built-ins as documented constants).
- `extractPrompt`: keep the existing per-event branches; add a **default branch** for unknown/plugin events — generic extraction: `(ctx.content as string) ?? (ctx.text as string) ?? JSON.stringify(ctx)`.
- `initializeTriggerHandlers(pluginEvents: string[] = [])`: subscribe to the 6 built-ins **plus** the distinct plugin trigger events. The caller (`createFlowsTriggerHandlers` / startup) passes the events collected from `collectFlowNodeDescriptors(registry)` filtered to `kind:'trigger'`. De-dupe before subscribing.
- Idempotency: `initializeTriggerHandlers` still guards with `initialized`, but must subscribe to any plugin events not yet subscribed (track a `Set<string>` of subscribed events rather than a single boolean).

### 4. Action node execution path

No new gateway code beyond what plugins already do: a plugin registers its action handler with `api.registerGatewayMethod(method, handler)`. The handler signature is the standard `GatewayRequestHandler` (`{ params, respond }`). The flow runtime calls that method by name. The action contract:

- **Request params:** `{ input: string, runId: string, nodeId: string }`.
- **Response:** `respond(true, { reply: string })` on success; `respond(false, undefined, errorShape(...))` on failure.

### 5. Reference plugin (proof of loop)

A **minimal, dedicated example plugin** under `extensions/flow-example/` (lightest path; not wiring heavy WhatsApp internals, but shaped exactly as a channel plugin would):

- `minion.plugin.json`: declares `flowNodes` with one trigger (`{ id:"example-event", kind:"trigger", event:"flow-example:ping", label:"Example ping" }`) and one action (`{ id:"echo", kind:"action", method:"flowExample.echo", label:"Example echo" }`).
- `register(api)`: registers `flowExample.echo` via `api.registerGatewayMethod`, returning `{ reply: "echo: " + params.input }`. Optionally registers a command/hook that emits `flow-example:ping` for manual trigger testing (or the trigger is exercised via a unit test that fires the hook directly).

This plugin exists to prove the contribution → palette → execution loop in tests and manual verification; it is not a shipped feature.

---

## langgraph-server Changes (meta-repo, branch `dev`)

### 1. Types (`src/flow/types.ts`)

Add `PluginTriggerNodeData`, `PluginActionNodeData`; extend `FlowNode.type` union with `'pluginTrigger' | 'pluginAction'`.

### 2. Gateway client: generic method call (`src/gateway/client.ts`)

Add `callGatewayMethod(method: string, params: Record<string, unknown>): Promise<string>` to the singleton client:

- Sends a `req` frame with the given `method` + `params` over the existing authenticated WS connection (reuse the request/await-`res` plumbing `sendAgentTurn` already uses).
- Extracts the reply from the `res` payload: `res.reply` (the action contract) with the same defensive fallback shape used by `extractReply`.
- Throws on `res.ok === false`.

### 3. `compileFlow` extension (`src/flow/compile-flow.ts`)

- `validateFlowShape`: include `pluginTrigger` in entry set, `pluginAction` in exec set (per Data Model).
- Entry resolution: a `pluginTrigger` behaves like a `trigger` — requires `opts.initialPrompt` (seed `HumanMessage`); throws `UnsupportedFlowError` if missing (same message pattern as trigger).
- `buildExecNode`: add a `pluginAction` branch →
  ```ts
  const data = node.data as PluginActionNodeData;
  const gc = opts.gatewayClient ?? { callGatewayMethod };
  return async (state) => {
    const lastHuman = [...state.messages].reverse().find((m) => m._getType() === 'human');
    if (!lastHuman) throw new Error('Plugin action node received no human message in state.');
    const reply = await gc.callGatewayMethod(data.method, {
      input: String(lastHuman.content), runId, nodeId: node.id,
    });
    return { messages: [new AIMessage(reply)] };
  };
  ```
- Extend the test `GatewayClient` interface to include `callGatewayMethod` (optional) so the existing `sendAgentTurn` injection still type-checks.

No new endpoint: `pluginTrigger` flows run through the existing `POST /flows/run-triggered`; `pluginAction` flows run through both `/flows/run` (manual) and `/flows/run-triggered`.

---

## Hub Changes (`minion_hub/`, branch `dev`)

### 1. RPC client (`src/lib/server/gateway-rpc.ts`)

`flowsNodesList(): Promise<FlowNodeDescriptor[]>` calling `gatewayCall('flows.nodes.list')`, returning `res.nodes`.

### 2. State types (`src/lib/state/features/flow-editor.svelte.ts`)

Add `PluginTriggerNodeData`, `PluginActionNodeData`; extend `FlowNode.type` and `FlowNode.data` unions. (Mirror langgraph-server types exactly, as SP-1/SP-2 kept them in sync.)

### 3. Generic `PluginNode.svelte` (new, `flow-editor/nodes/`)

One component for both kinds (branch on `data` shape / a `kind` prop):

- Renders the descriptor: icon (Phosphor), label, a small plugin-id badge.
- `pluginTrigger`: one output handle (`out`, emerald), no input — entry node. Includes the SP-2 `deliverResponse` toggle.
- `pluginAction`: input handle (`in`) + output handle (`out`) — exec node.
- Distinct accent color (e.g. violet) to visually distinguish plugin nodes from built-ins.

Registered in `FlowCanvas.svelte` `nodeTypes`: `pluginTrigger: PluginNode, pluginAction: PluginNode`.

### 4. `FlowSidebar.svelte` palette

- Fetch contributed descriptors on mount via the hub RPC (server load or `gatewayCall` path the sidebar already uses for agents/models).
- Render a **"Plugin nodes"** section, grouped by `pluginId`, each descriptor a draggable item. Drag payload: `{ type: descriptor.kind === 'trigger' ? 'pluginTrigger' : 'pluginAction', descriptor }` on the `application/flow-node` key.
- If no plugins contribute nodes, the section is hidden.

### 5. `FlowCanvas.svelte` drop handler

Add `pluginTrigger` / `pluginAction` branches. Instantiate node `data` from the dropped descriptor:

```ts
// pluginTrigger
{ pluginId: d.pluginId, contributionId: d.id, event: d.event, label: d.label, deliverResponse: false }
// pluginAction
{ pluginId: d.pluginId, contributionId: d.id, method: d.method, label: d.label }
```

### 6. Activation (re-uses SP-2)

A `pluginTrigger` is an entry node, so the existing **Activate/Deactivate** button (shown when the flow has any trigger-role entry) registers it through `flows.trigger.register` with `{ flowId, event: data.event, deliverResponse: data.deliverResponse }`. Extend the "has trigger" check and the SP-2 re-registration loop (`gateway.svelte.ts`) to also recognize `pluginTrigger` nodes.

---

## Error Handling

| Scenario | Behavior |
|---|---|
| Manifest `flowNodes` entry malformed | Loader skips that entry, keeps valid ones (mirrors `ui[]` parsing). Plugin still loads. |
| `flows.nodes.list` called, no plugins contribute | Returns `{ nodes: [] }`. Hub hides the "Plugin nodes" section. |
| `pluginAction` method not registered (plugin disabled after flow built) | `callGatewayMethod` gets `res.ok === false` (unknown method) → throws → run-triggered returns `{ error }` (HTTP 500); manual `/flows/run` surfaces the error to the console. Gateway does not crash. |
| Plugin handler throws / responds `ok:false` | `callGatewayMethod` throws; same as above. |
| `pluginTrigger` event never emitted by plugin | Flow simply never fires. No error. |
| Plugin trigger event collides with a built-in event key | Allowed — both subscriptions fire; filters disambiguate. De-dupe prevents double subscription to the same key. |
| Hub flow references a `pluginId` that's no longer installed | `flows.nodes.list` omits it from palette, but a saved flow still has the node. On run, `callGatewayMethod` fails as above. (No migration/cleanup in this sprint.) |

---

## Testing

**Gateway (`minion/`):**
- Unit: manifest loader parses valid `flowNodes`, skips malformed entries, requires `event`/`method` per kind.
- Unit: `collectFlowNodeDescriptors` flattens a fake registry → descriptors with `pluginId`, skips disabled plugins.
- Unit: `flows.nodes.list` handler returns `{ nodes }`; error path responds `ok:false`.
- Unit: trigger-manager `extractPrompt` default branch (generic extraction) for an unknown event; `initializeTriggerHandlers(pluginEvents)` subscribes built-ins + plugin events, de-dupes, is idempotent across calls.
- Integration: load the `flow-example` reference plugin; assert its trigger + action appear in `flows.nodes.list`; call `flowExample.echo` via the handler → `{ reply: "echo: …" }`.

**langgraph-server:**
- Unit: `validateFlowShape` accepts `pluginTrigger`→`pluginAction`, `promptBox`→`pluginAction`, `pluginTrigger`→`llm`; rejects two execs / two entries / pluginTrigger+promptBox.
- Unit: `compileFlow` `pluginAction` branch calls injected `gatewayClient.callGatewayMethod` with `{input, runId, nodeId}` and returns its reply as the final `AIMessage`.
- Unit: `compileFlow` `pluginTrigger` requires `initialPrompt` (throws without it; seeds `HumanMessage` with it).

**Hub:**
- Unit: drop handler produces correct `PluginTriggerNodeData` / `PluginActionNodeData` from a descriptor.
- Unit: "has trigger" activation check recognizes `pluginTrigger`.
- Manual: install reference plugin, open flow editor, see "Plugin nodes" section, drag trigger→action, run/activate, observe `echo:` reply.

---

## Out of Scope (SP-4+)

- **Config fields on plugin nodes** (per-node parameters with a schema; opaque config in node data passed through to the plugin). MVP descriptors carry no config.
- **Multi-node chains** (plugin action as a mid-graph node between other nodes).
- **Plugin-supplied custom Svelte components** (remains a generic descriptor renderer; no plugin JS in the hub).
- Hot-reload of contributed nodes when a plugin is installed/removed at runtime (palette is fetched on editor mount).
- Cleanup/migration of saved flows referencing uninstalled plugins.
- Versioning / compatibility checks between a contribution and the flow runtime.

---

## Config Summary

No new env vars. SP-3 reuses the existing gateway WS connection (`GATEWAY_TOKEN`), `FLOWS_RUNNER_URL`, `HUB_URL`, `HUB_API_TOKEN`, and `PUBLIC_LANGGRAPH_FLOWS_URL` from SP-1/SP-2.
