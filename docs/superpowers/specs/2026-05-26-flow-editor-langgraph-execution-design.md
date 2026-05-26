# Flow-Editor Execution via LangGraph — Design

**Date:** 2026-05-26
**Status:** Approved (design) — pending spec review before planning
**Author:** brainstorming session
**Scope:** MVP slice only. Progressive features documented but explicitly out of scope.

## Problem

The hub flow-editor (`minion_hub/src/routes/(app)/flow-editor/`) is a visual DAG
designer built on `@xyflow/svelte`. Users compose flows of `agent` and `promptBox`
nodes and save them as nodes+edges JSON to the `flows` table. **But flows are never
executed.** The "test run" (`flow-editor/[id]/+page.svelte`, `handleTestRun`) is a
mock — it appends fake log lines on `setTimeout` and never contacts an agent or model.

We want flows to actually run. Rather than hand-write a DAG execution engine
(topological ordering, state passing, branching, loops, retries, streaming,
checkpointing), we use **LangGraph**, which already solves that problem and is
maintained for exactly this purpose. The `langgraph-server/` project already exists
and uses LangGraph + `@langchain/anthropic`.

### Why LangGraph here (and not in `minion/` core)

`minion/` core already has a production orchestration engine (`@earendil-works/pi-*`),
so LangGraph there would be a redundant competing engine. The flow-editor is the
opposite: the execution engine **does not exist yet**. The hard part is unbuilt, which
is precisely where LangGraph earns its keep.

## North Star (target architecture — NOT built in this slice)

The entire flows feature becomes a **self-contained "flows plugin"** that bundles:

1. The flow-editor **UI** (the `(app)/flow-editor` route + components).
2. The **`langgraph-server`** execution backend.

> User: "the entire flows page can/should be its own plugin as well, that comes with
> the langchain server."

**Single config, single source of truth.** Because the plugin ships both halves, the
langgraph-server **URL is defined once in the plugin config** and consumed by both:
- the server (where it binds / what base path it serves), and
- the hub's API calls (where it POSTs flows to).

> User: "since this is a plugin, the UI is also shipped with the plugin, so the link
> is set in the plugin and can be configured into both the server and the api calls in
> a single config."

This slice does **no plugin packaging**. It keeps the two halves as cooperating parts
with a single shared config value, so later extraction into a plugin is clean.

## MVP Scope (this slice)

A flow of **exactly one `promptBox` → one `agent` node** runs for real and streams
its output into the existing `ConsolePanel`, replacing the mock. Concretely:

- The `agent` node calls **Claude directly** in `langgraph-server` (`ChatAnthropic`).
  No minion-gateway agent routing yet.
- The `agent` node gains an **in-node picker** to choose its target (model/persona),
  writing the existing `data.agentId` / `data.label` fields.
- A real **Run** action collects the flow JSON, POSTs it to langgraph-server, and
  streams events back into the console.

### Explicitly OUT of scope (progressive roadmap)

- Multi-node DAGs / branching / fan-out.
- `context` edges (dashed amber) semantics.
- Routing to **real** `gw.*` / `built:*` agents through the minion gateway
  (requires a service-token gateway bridge inside langgraph-server).
- Plugin packaging / extraction.
- Checkpointing, human-in-the-loop pauses, persistence of runs.

## Architecture

```
minion_hub (browser)                       langgraph-server (Node)
┌──────────────────────────┐               ┌───────────────────────────────┐
│ flow-editor [id] page     │  POST flow    │ POST /flows/run  (new endpoint) │
│  Run → collect nodes/edges┼─────JSON─────▶│  1. validate flow JSON (zod)    │
│ flow-editor.svelte.ts      │               │  2. compileFlow → StateGraph    │
│  runFlow(): consume SSE    │◀────SSE───────┤  3. graph.stream() → SSE events │
│ ConsolePanel: real logs    │   events      │  4. agent node = ChatAnthropic  │
└──────────────────────────┘               └───────────────────────────────┘
        ▲                                              ▲
        └──────── shared config: LANGGRAPH_FLOWS_URL ──┘
                  (single value, used by both sides)
```

### Component 1 — `compileFlow` (the heart, isolated + unit-testable)

A **pure function** in `langgraph-server`, no HTTP / no I/O:

```
compileFlow(nodes: FlowNode[], edges: FlowEdge[]) -> CompiledStateGraph
```

Behavior for the MVP shape:
- Validate the flow is the supported shape (exactly one `promptBox`, exactly one
  `agent`, connected prompt→agent). On any other shape, throw a typed
  `UnsupportedFlowError` with a human-readable reason.
- Topologically order nodes from edges (trivial for two nodes, but written generally
  enough to extend).
- `promptBox` node → seeds initial graph state: its `value` becomes the initial human
  message.
- `agent` node → a `StateGraph` node that invokes `ChatAnthropic` (model resolved from
  the node's picker selection) over the current messages.
- Returns a compiled graph: `StateGraph(MessagesAnnotation).addNode(...).addEdge(...).compile()`.

This is deliberately a real per-request `StateGraph` translation (not a generic
interpreter), so future visualization/checkpointing is native.

### Component 2 — HTTP endpoint `POST /flows/run`

A **separate lightweight HTTP server** in `langgraph-server` (own port, e.g. 2025),
distinct from the `langgraph dev` CLI server on 2024.

**Why separate:** the CLI server (2024) only serves graphs **pre-registered** in
`langgraph.json`; it cannot accept an arbitrary compiled graph per request. A small
own-endpoint sidesteps that and cleanly supports compile-per-request. The 2024 server
stays untouched for Studio + the `research` agent.

Endpoint contract:
- Request body: `{ nodes: FlowNode[], edges: FlowEdge[] }`.
- Validates with zod; on `UnsupportedFlowError` returns a structured error event.
- Calls `compileFlow`, then `graph.stream(initialState)`.
- Responds as **Server-Sent Events**, one event per emitted log/chunk:
  `{ level, message, nodeId? }`, ending with a terminal `done` (or `error`) event.

Framework: Hono (small, modern) unless an existing dependency makes Node `http`
simpler — final choice deferred to the plan, both are acceptable.

### Component 3 — Hub `runFlow` (replaces the mock)

In `minion_hub/src/lib/state/features/flow-editor.svelte.ts`:
- New exported `runFlow()` that:
  - sets `isRunning`, opens console, clears logs;
  - POSTs `{ nodes, edges }` to `${LANGGRAPH_FLOWS_URL}/flows/run`;
  - reads the SSE/stream response and `appendLog(...)` per event;
  - surfaces validation/transport errors as `error`-level logs;
  - clears `isRunning` on the terminal event.
- `flow-editor/[id]/+page.svelte`: `handleTestRun` is replaced by calling `runFlow()`.

### Component 4 — Agent node picker

In `minion_hub/src/lib/components/flow-editor/nodes/AgentNode.svelte`:
- Add a small `<select>` (or existing dropdown component) listing available targets.
- For the MVP, the target list is model/persona options (since execution is
  direct-LLM). Selection writes `data.agentId` + `data.label` and marks the flow dirty
  via the existing `setNodes`/`markDirty` path.
- No new node fields — reuses the existing `AgentNodeData` shape.

### Shared config

A single config value for the langgraph-server base URL:
- Hub side: `PUBLIC_LANGGRAPH_FLOWS_URL` (defaults to `http://localhost:2025` in dev).
- Server side: the same value drives the port/base path it binds.
- The spec records the intent that, post-plugin-extraction, this collapses into the
  plugin's single config entry. For this slice it's one documented env var mirrored on
  both sides.

## Data Model

**No schema change.** Reuses the existing `flows` table and the `FlowNode` / `FlowEdge`
/ `AgentNodeData` / `PromptBoxData` types in `flow-editor.svelte.ts` verbatim.

## Error Handling

- Unsupported flow shape → `UnsupportedFlowError` → structured `error` SSE event →
  red log line in the console naming the reason (e.g. "Flow must be exactly one prompt
  connected to one agent").
- LLM/network failure inside the agent node → caught, emitted as an `error` event,
  run terminates cleanly (no hung `isRunning`).
- Hub transport failure (server down) → single `error` log: "Could not reach flow
  runner at <url>".

## Testing

- **Unit (langgraph-server):** `compileFlow` — happy path (prompt→agent compiles and,
  with a stubbed model, produces an assistant message) + rejects each unsupported
  shape with `UnsupportedFlowError`.
- **Unit (hub):** `runFlow` SSE parsing against a mocked `fetch` stream — asserts logs
  are appended in order and `isRunning` resets on terminal event.
- **Manual:** drop prompt→agent, pick a model, hit Run, watch real streamed output land
  in the console.

## Build Sequence (high level — detailed plan follows in writing-plans)

1. `compileFlow` pure module + unit tests (TDD).
2. `/flows/run` HTTP endpoint + SSE streaming.
3. Hub `runFlow` + SSE consumption + tests; wire into `+page.svelte`.
4. Agent node picker.
5. Shared config env var on both sides + dev defaults.
6. Manual end-to-end verification.

## Open Questions / Risks

- **HTTP framework choice** (Hono vs Node `http`) — deferred to plan.
- **Streaming granularity:** `graph.stream()` event shape for a single-node graph is
  coarse; MVP only needs start/output/done. Finer per-token streaming is a later
  enhancement.
- **Version pin:** `@langchain/langgraph` stays pinned at 1.3.1 (1.3.2 has a known
  thread-history TypeError regression).
