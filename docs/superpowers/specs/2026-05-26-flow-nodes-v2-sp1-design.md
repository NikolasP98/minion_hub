# Flow Nodes v2 — SP-1: LLM Node + Real-Agent Node

**Date:** 2026-05-26
**Status:** Approved — pending spec review
**Repos:** `minion_hub` (hub UI) · `langgraph-server` (flow runtime)
**Series:** SP-1 of 3 (SP-2: trigger nodes · SP-3: plugin-contributed nodes)

---

## Problem

The MVP shipped a single `agent` node type that conflates two distinct things:
- **Direct LLM execution** — calls Claude with a model id, no gateway needed.
- **Gateway-agent routing** — should route to a real connected agent (PANIK, renzo_bot, leiva_bot…).

This conflation produced two bugs:
1. **UX gap**: you can only drop an Agent node from the palette if a gateway agent is listed there. If the gateway WS isn't connected or no agents are running, the palette says "No agents connected" and you can't build a runnable flow.
2. **Semantic mismatch**: the existing node picker showed Claude model names on a node called "Agent", which is confusing.

SP-1 resolves this by introducing a clean node-type split.

---

## Goal

Two new/reworked node types with distinct palette items, distinct Svelte components, and distinct execution paths:

| Node type | Palette section | Picker | Execution |
|---|---|---|---|
| `llm` | INPUTS (always available) | Claude model from `models.list` RPC | Direct ChatAnthropic (current path) |
| `agent` | AGENTS (lists connected gw agents) | Real gw agent from `agents.list` RPC | Routes turn to gateway agent via WS |

---

## Architecture

```
minion_hub (browser)
  FlowSidebar  ── gw.agents (agents.list RPC) ─── palette Agent items
               ── "LLM" item (always shown)
  LLMNode      ── models.list RPC ──────────────── model picker <select>
  AgentNode    ── gw.agents ─────────────────────── agent picker <select>
               ── sessionMode toggle (ephemeral | shared)

langgraph-server
  POST /flows/run ─── compileFlow ─── llm node ──► ChatAnthropic (direct)
                                  └── agent node ─► gatewayClient.sendAgentTurn()
                                                        │
  GatewayClient (new) ────────────────────────────────  ▼
    persistent WS ──► minion gateway ──► chat.send { agentId, sessionKey, deliver:false }
                                              │
                                              ▼
                                         assistant reply ──► SSE stream ──► ConsolePanel
```

---

## Data Model

### New `LLMNodeData`

```ts
export type LLMNodeData = {
  modelId: string;   // e.g. 'claude-haiku-4-5-20251001'
  label: string;
};
```

### Reworked `AgentNodeData`

```ts
export type AgentNodeData = {
  agentId: string;                        // gateway agent id, e.g. 'PANIK'
  label: string;
  sessionMode: 'ephemeral' | 'shared';    // NEW — per-node toggle
  inputHandles: HandleDef[];
  outputHandles: HandleDef[];
  contextHandles: HandleDef[];
};
```

### `FlowNode.type` union

```ts
type FlowNodeType = 'agent' | 'promptBox' | 'llm';  // llm is new
```

### Backward compatibility

Existing `agent` nodes with a `claude-*` agentId continue to work: `resolveModelId` maps them to direct LLM execution. No migration of saved flows is required.

---

## langgraph-server Changes

### 1. Gateway WS client (`src/gateway/client.ts`)

A module-level singleton that:
- Opens a persistent WebSocket to `GATEWAY_URL` (env) at import time.
- Authenticates via the existing frame-protocol handshake (`connect.challenge` → `connect { token: GATEWAY_TOKEN }`).
- Reconnects automatically on disconnect (simple exponential backoff, max 30s).
- Exposes:

```ts
export async function sendAgentTurn(
  agentId: string,
  prompt: string,
  sessionMode: 'ephemeral' | 'shared',
  runId: string,
  nodeId: string,
): Promise<string>
```

Session key derivation:
- `ephemeral`: `flow-run:${runId}:${nodeId}` — unique per run, never shared with the agent's real session.
- `shared`: `agent:${agentId}:main` — the agent's live main session.

The method calls `chat.send { agentId, message: prompt, sessionKey, deliver: false, idempotencyKey: runId }`.

**Implementation note — verify `chat.send` response shape:** The gateway may respond to `chat.send` synchronously (the `res` frame contains the completed assistant reply) or asynchronously (the `res` frame is an ack and the reply arrives as a subsequent `event` frame). The hub's my-agent voice-call feature (`sendVoiceTurn`) uses this same method — trace `gateway.svelte.ts:sendVoiceTurn` during implementation to confirm the exact reply surface before writing the gateway client's await logic.

If the gateway is unreachable, `sendAgentTurn` throws a descriptive error that surfaces as an `error` SSE event in the ConsolePanel.

### 2. New env vars in `langgraph-server/.env`

```
GATEWAY_URL=ws://localhost:8765           # minion gateway WS endpoint
GATEWAY_TOKEN=<your-gateway-token>        # MINION_GATEWAY_TOKEN value

# LLM provider — OpenRouter is the default (routes any model string)
OPENROUTER_API_KEY=<your-openrouter-key>  # preferred — enables all OpenRouter models
ANTHROPIC_API_KEY=<your-anthropic-key>   # fallback if only Anthropic is configured
```

**Provider selection logic:** langgraph-server picks the provider at startup:
1. `OPENROUTER_API_KEY` set → use OpenRouter (`@langchain/openai` with `baseURL: 'https://openrouter.ai/api/v1'`). Any model string from `models.list` works without extra config.
2. Otherwise, `ANTHROPIC_API_KEY` set → use `ChatAnthropic` (current behaviour).
3. Neither set → server starts but `llm` node execution returns an error event at runtime.

OpenRouter is the recommended default because it accepts any model id (claude, gpt-4o, mistral, llama, deepseek, etc.) that the gateway's `models.list` may return, with no per-provider credential management in langgraph-server.

### 3. `compileFlow` extensions (`src/flow/compile-flow.ts`)

**`validateFlowShape`** is extended to accept either `llm` or `agent` as the execution node:
- Exactly one `promptBox` node.
- Exactly one execution node: `type === 'llm'` OR `type === 'agent'`.
- A `flow`-type edge connecting prompt → execution node.

**Execution node compilation:**

`llm` node → a `StateGraph` node that invokes `resolveProviderModel(modelId)`. The model factory (new helper `src/flow/provider.ts`) returns a `BaseChatModel` wrapping:
- OpenRouter (`ChatOpenAI` → `baseURL: 'https://openrouter.ai/api/v1'`) if `OPENROUTER_API_KEY` is set, or
- `ChatAnthropic` if only `ANTHROPIC_API_KEY` is set.

The `modelId` string (e.g. `'anthropic/claude-haiku-4-5'`, `'openai/gpt-4o'`, `'mistralai/mistral-large'`) is passed verbatim to whichever provider is active.

`agent` node → a StateGraph node:
```ts
async function callGatewayAgent(state: typeof MessagesAnnotation.State) {
  const lastHuman = state.messages.findLast((m) => m._getType() === 'human');
  const reply = await sendAgentTurn(
    agentNode.data.agentId,
    String(lastHuman?.content ?? ''),
    agentNode.data.sessionMode,
    runId,
    agentNode.id,
  );
  return { messages: [new AIMessage(reply)] };
}
```

### 4. `resolveModelId` (removed from LLM path)

`resolveModelId` was a heuristic for the MVP's conflated node. With the clean split:
- `llm` node → `data.modelId` is passed verbatim to the provider. No resolution needed.
- `agent` node → `data.agentId` is passed verbatim to `sendAgentTurn`. No resolution needed.
- `resolveModelId` is **kept only for backward compat** on existing `agent` nodes with a claude-* agentId:

```ts
// Backward compat: 'agent' node with a claude-* id → treat as llm node
const isLegacyLLM = node.type === 'agent' && node.data.agentId?.startsWith('claude-');
```

This avoids breaking saved flows (e.g. the MVP "PONG demo" flow).

### 5. `server.ts` zod schema

`FlowRunRequest.nodes.type` expands to `z.enum(['agent', 'promptBox', 'llm'])`.

---

## minion_hub Changes

### 1. New `LLMNode.svelte`

- Displays a `<select>` populated from `sendRequest('models.list', {})` on mount. `models.list` reflects the gateway's configured providers — **OpenRouter is the default**, meaning the picker shows all OpenRouter-available models (claude, gpt-4o, mistral, llama, deepseek, etc.); if the user has a different provider set up, that provider's models appear instead.
- Falls back to showing just the gateway's `defaultModel` (from the RPC response) if model list fetch fails. If the gateway itself is unreachable, shows a minimal hardcoded fallback (`claude-haiku-4-5-20251001`) with a visible warning. No silent failure.
- Output handle only (right side, emerald, `id: 'out'`). No input handle.
- `onchange` writes `data.modelId` + `data.label` via `setNodes`.
- `onclick` stop-propagation (prevents node drag eating the click).

### 2. Reworked `AgentNode.svelte`

- Picker `<select>` lists real `gw.agents` by name (replaces MODEL_OPTIONS entirely).
- Adds a `sessionMode` toggle: two small pills/buttons — **Ephemeral** / **Shared** — below the agent picker. Default: `'ephemeral'`.
- `pickAgent(e)` writes `data.agentId`, `data.label`, `data.sessionMode` via `setNodes`.
- Falls back gracefully when `gw.agents` is empty: shows a "No agents connected" disabled option (not a crash, not broken — just can't execute until an agent is connected).
- Removes all `MODEL_OPTIONS` references.

### 3. `FlowSidebar.svelte`

- Adds an **LLM** button in the INPUTS section (above Prompt Box or in a new "Models" sub-section):
  - On click/drag: creates an `llm` node with `data: { modelId: 'claude-haiku-4-5-20251001', label: 'LLM' }`.
  - Always available — not gated on gateway connection.
- The AGENTS section is unchanged (still lists `gw.agents` + `builderState.agents`; each creates an `agent` node).

### 4. `FlowCanvas.svelte`

- Adds `llm: LLMNode` to `nodeTypes`.
- Drop handler adds `else if (payload.type === 'llm')` branch that creates an `LLMNode` with defaults.
- `payload.type` union in `handleDragStart` expands to include `'llm'`.

### 5. `flow-editor.svelte.ts`

- Adds `LLMNodeData` type.
- Updates `AgentNodeData` to add `sessionMode: 'ephemeral' | 'shared'`.
- Updates `FlowNode.type` union to `'agent' | 'promptBox' | 'llm'`.

### 6. `flow-run.ts` (no change)

The `FlowRunEvent` and `readSseStream` are not affected — same SSE contract.

---

## Error Handling

| Scenario | Behavior |
|---|---|
| Gateway not connected when Agent node runs | `error` SSE event: "Gateway agent not reachable — check GATEWAY_URL and GATEWAY_TOKEN." |
| Agent id not found by gateway | `error` SSE event with gateway's error message |
| Neither OPENROUTER_API_KEY nor ANTHROPIC_API_KEY set | `error` SSE event: "No LLM provider configured — set OPENROUTER_API_KEY or ANTHROPIC_API_KEY." |
| `models.list` RPC fails in LLM node picker | Falls back to gateway's `defaultModel` if available; otherwise shows minimal hardcoded fallback with a warning |
| `gw.agents` empty when AgentNode renders | Picker shows "No agents connected" disabled option |
| Legacy `agent` node with claude-* id | Falls back to direct LLM execution (backward compat) |

---

## Testing

**langgraph-server:**
- `compileFlow` unit tests: add `llm` node case (injected fake model → same pattern as existing tests); `agent` node case (inject fake `gatewayClient`, assert `sendAgentTurn` called with correct args and reply returned).
- Gateway client: mock WS server test — assert handshake completes and `chat.send` frame is sent with correct fields, reply frame produces the correct string.

**minion_hub:**
- `readSseStream` and `runFlow` tests: no change needed (SSE contract unchanged).
- `LLMNode.svelte`: test that `models.list` RPC populates the picker and that fallback renders on failure.
- `AgentNode.svelte`: test that sessionMode toggle writes to node state.

---

## Out of Scope (SP-2 / SP-3)

- Multi-node DAG execution (more than 1 execution node).
- Trigger nodes / event-driven flow entry points (SP-2).
- Plugin-contributed node types in the palette (SP-3).
- `built:*` agent execution via gateway (builder agents are separate from `gw.agents`; route defined in SP-2+ or as a follow-up to SP-1).

---

## Config Summary

| Key | Where | Purpose |
|---|---|---|
| `OPENROUTER_API_KEY` | `langgraph-server/.env` | **Primary** LLM provider — routes any model string (claude, gpt-4o, mistral, llama…) |
| `ANTHROPIC_API_KEY` | `langgraph-server/.env` | Fallback LLM provider if only Anthropic is configured |
| `GATEWAY_URL` | `langgraph-server/.env` | Gateway WS endpoint for agent routing |
| `GATEWAY_TOKEN` | `langgraph-server/.env` | Auth token for gateway WS connection |
| `PUBLIC_LANGGRAPH_FLOWS_URL` | `minion_hub/.env` | Hub → langgraph-server /flows/run (from MVP) |
