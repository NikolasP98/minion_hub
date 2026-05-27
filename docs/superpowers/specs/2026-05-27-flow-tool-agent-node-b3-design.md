# Flow Editor — Tool-calling Agent Node (Sub-feature B3)

**Date:** 2026-05-27
**Status:** Approved — pending spec review
**Repos:** `langgraph-server` (tool registry + ReAct runner) · `minion_hub` (ToolAgentNode component + palette)
**Series:** Sub-feature **B**, phase **B3** of 3 (final). B1 (graph foundation + Transform/Structured) and B2 (Router/Conditional) are DONE. This phase depends on B1's DAG compile.

---

## Problem

The flow editor can run direct-LLM nodes (`llm`), structured-output nodes (`structured`), and gateway agents (`agent`), and it can branch (`router`). What it cannot do is run an LLM that **calls tools in a loop** — search the web, compute, or invoke a gateway capability mid-reasoning, then continue. B3 adds a `toolAgent` node: a model bound to a selected set of tools, driven by a ReAct loop, that returns a final answer after any number of tool calls (capped).

---

## Goal

A `toolAgent` node with:
- A **model** selection.
- An optional **system prompt** to steer the agent.
- A **multi-select tool picker**: a fixed set of safe built-in tools, plus gateway-method tools (the same plugin-action methods the `pluginAction` node exposes).
- An internal **ReAct loop** via LangGraph's prebuilt `createReactAgent`, bounded by a **fixed recursion limit of 10**.

The node reads the latest message as input, runs the agent loop, and appends the agent's final AI message. It is a normal append node (not conditional like `router`) — fan-out and sink→END edges behave exactly as in B1.

**Locked decisions:** tool source = built-ins + gateway tools; loop = `createReactAgent` (prebuilt); config = model + tools + optional system prompt; loop bound = fixed recursion limit 10 (not user-tunable in B3).

---

## Data Model

Mirrored in `langgraph-server/src/flow/types.ts` and `minion_hub/src/lib/state/features/flow-editor.svelte.ts`:

```ts
export type ToolRef =
  | { kind: 'builtin'; id: string }
  | { kind: 'gateway'; method: string; name: string; description: string };

export type ToolAgentNodeData = {
  modelId: string;
  systemPrompt?: string;
  tools: ToolRef[];
  label: string;
};
```

- `FlowNode.type` union gains `'toolAgent'`; the `data` union gains `ToolAgentNodeData`.
- **Built-in tool refs** carry only a stable `id` (`web_search` | `current_time` | `calculator`); the runtime resolves the implementation from a static registry.
- **Gateway tool refs** carry `method` (the gateway RPC method), `name` (tool name shown to the LLM), and `description` (so the LLM knows when to call it). Carrying the descriptor in node data keeps `compileFlow` pure and test-friendly — no discovery RPC at compile time.

---

## Architecture

```
prompt ─▶ toolAgent ─▶ (next node | END)

toolAgent runner:
  tools  = buildTools(data.tools, opts)        // builtins from registry + gateway wraps
  model  = opts.model ?? resolveProviderModel(data.modelId)
  agent  = (opts.reactAgentFactory ?? createReactAgent)({ llm: model, tools })
  result = await agent.invoke(
             { messages: [SystemMessage(systemPrompt)?, ...state.messages] },
             { recursionLimit: 10 },
           )
  return { messages: [<final AI message from result.messages>] }
```

The node appends exactly one message — the agent's final answer — so downstream nodes see it via `lastMessageContent` (the B1 input contract). Intermediate tool-call/tool-result messages stay inside the agent run and are not appended to the flow state.

---

## Runtime Changes (`langgraph-server`, branch `dev`)

### 1. Types
Add `ToolRef` and `ToolAgentNodeData` (above). Add `'toolAgent'` to `FlowNode.type` and `ToolAgentNodeData` to the `data` union.

### 2. `validateFlowShape`
Add `'toolAgent'` to `PROCESSING_TYPES` so it is reachability-checked, included in the cycle DFS, and gets a graph node. No other validation change.

### 3. New file `src/flow/tools.ts` — the built-in registry + builder

```ts
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { TavilySearch } from '@langchain/tavily';
import type { StructuredToolInterface } from '@langchain/core/tools';
import { callGatewayMethod } from '../gateway/client.js';
import type { ToolRef } from './types.js';
import type { FlowRunEvent } from './types.js';

/** Safe arithmetic: only digits, whitespace, + - * / . ( ) — no identifiers, no eval/Function. */
export function safeEvalArithmetic(expr: string): number {
  if (!/^[0-9+\-*/().\s]+$/.test(expr)) {
    throw new Error('calculator: only numbers and + - * / ( ) are allowed');
  }
  // Shunting-yard / recursive-descent over the validated token set (no JS eval).
  return evalArithmeticExpression(expr);   // implemented in this file
}

/** A gateway invoker, injectable for tests. */
export type GatewayInvoke = (method: string, params: Record<string, unknown>) => Promise<string>;

export interface BuildToolsOptions {
  gatewayInvoke?: GatewayInvoke;
  env?: Record<string, string | undefined>;
  runId?: string;
  nodeId?: string;
  onEvent?: (e: FlowRunEvent) => void;   // for "web_search dropped, no TAVILY_API_KEY"
}

/** Static built-in tool factories, keyed by stable id. */
export const BUILTIN_TOOL_IDS = ['web_search', 'current_time', 'calculator'] as const;

export function buildTools(refs: ToolRef[], opts: BuildToolsOptions = {}): StructuredToolInterface[] {
  const env = opts.env ?? process.env;
  const invoke = opts.gatewayInvoke ?? callGatewayMethod;
  const out: StructuredToolInterface[] = [];
  for (const ref of refs) {
    if (ref.kind === 'builtin') {
      if (ref.id === 'web_search') {
        if (!env.TAVILY_API_KEY) {
          opts.onEvent?.({ level: 'warn', message: 'web_search skipped — TAVILY_API_KEY not set', nodeId: opts.nodeId });
          continue;
        }
        out.push(new TavilySearch({ maxResults: 5, tavilyApiKey: env.TAVILY_API_KEY }));
      } else if (ref.id === 'current_time') {
        out.push(tool(async () => new Date().toISOString(), {
          name: 'current_time',
          description: 'Returns the current date and time as an ISO 8601 string.',
          schema: z.object({}),
        }));
      } else if (ref.id === 'calculator') {
        out.push(tool(async ({ expression }) => String(safeEvalArithmetic(expression)), {
          name: 'calculator',
          description: 'Evaluates a basic arithmetic expression (+, -, *, /, parentheses).',
          schema: z.object({ expression: z.string() }),
        }));
      }
      // Unknown builtin id → skipped (forward-compatible).
    } else {
      const { method, name, description } = ref;
      out.push(tool(
        async ({ input }) => invoke(method, { input, runId: opts.runId, nodeId: opts.nodeId }),
        { name, description, schema: z.object({ input: z.string() }) },
      ));
    }
  }
  return out;
}
```

(`evalArithmeticExpression` is a small recursive-descent parser over the already-regex-validated string — implemented in the plan. The regex guard alone prevents any identifier/`eval` access; the parser just produces the number.)

### 4. ToolAgent runner in `buildNodeRunner`

Add before the final unknown-type throw:

```ts
if (node.type === 'toolAgent') {
  const data = node.data as ToolAgentNodeData;
  const model: ChatModel = opts.model ?? resolveProviderModel(data.modelId ?? DEFAULT_MODEL);
  const factory = opts.reactAgentFactory ?? createReactAgent;
  return async (state) => {
    const tools = buildTools(data.tools ?? [], {
      gatewayInvoke: opts.gatewayClient?.callGatewayMethod,
      runId, nodeId: node.id,
    });
    const agent = factory({ llm: model as unknown, tools });
    const messages = data.systemPrompt
      ? [new SystemMessage(data.systemPrompt), ...state.messages]
      : state.messages;
    const result = await agent.invoke({ messages }, { recursionLimit: TOOL_AGENT_RECURSION_LIMIT });
    const last = result.messages[result.messages.length - 1];
    return { messages: [last] };
  };
}
```

- `TOOL_AGENT_RECURSION_LIMIT = 10` exported constant.
- `createReactAgent` imported from `@langchain/langgraph/prebuilt`.
- `opts.reactAgentFactory` added to `CompileOptions` (typed loosely as a factory returning `{ invoke(input, config?): Promise<{ messages: BaseMessage[] }> }`) so tests inject a fake agent and never touch a live LLM.
- The `model as unknown` cast bridges the local `ChatModel` test interface to what `createReactAgent` expects; mirrors the existing `AnyGraph` cast pattern (no `any`).

### 5. `CompileOptions`
Add:
```ts
/** Inject the ReAct agent factory for tests (toolAgent path). Defaults to createReactAgent. */
reactAgentFactory?: (args: { llm: unknown; tools: unknown[] }) => {
  invoke(input: { messages: BaseMessage[] }, config?: { recursionLimit?: number }): Promise<{ messages: BaseMessage[] }>;
};
```

---

## Hub Changes (`minion_hub`, branch `dev`)

### 1. Types
Mirror `ToolRef` + `ToolAgentNodeData` in `flow-editor.svelte.ts`; extend `FlowNode.type` + `data` union.

### 2. `ToolAgentNode.svelte`
- Input handle (left), single output handle (right) — same shape as `LLMNode`/`StructuredNode`.
- **Model select** — reuse `sendRequest('models.list', {})` + fallback (same pattern as StructuredNode/RouterNode).
- **System prompt** — a `<textarea>` bound to `data.systemPrompt`.
- **Tool picker:**
  - Built-ins: three checkboxes (`web_search`, `current_time`, `calculator`); checking adds `{ kind: 'builtin', id }` to `data.tools`, unchecking removes it.
  - Gateway tools: reuse the **plugin-action method picker** the `pluginAction` node already uses to choose a `{ pluginId, contributionId, method }`; on add, append `{ kind: 'gateway', method, name, description }` (name defaults to the method's last segment, description from the contribution metadata or an editable input). A removable list shows the currently-selected gateway tools.
- All edits write via the existing `setNodes` map + `patch` pattern. Violet/indigo accent + a `Wrench` (or `Bot`) lucide icon.

### 3. Register + palette + drop
- Register `toolAgent: ToolAgentNode` in `FlowCanvas.svelte` `nodeTypes`.
- `FlowSidebar`: a "Tool Agent" palette item (both views).
- `FlowCanvas` `handleDrop`: a `toolAgent` branch with default data `{ modelId: '', systemPrompt: '', tools: [], label: 'Tool Agent' }`; widen the payload `type` union.

(No edge-model change — `toolAgent` uses a single source handle like the other append nodes.)

---

## Error Handling

| Scenario | Behavior |
|---|---|
| `web_search` selected but `TAVILY_API_KEY` unset | Tool silently dropped from the bound set; a `warn` `FlowRunEvent` is emitted. Agent runs with remaining tools. |
| `calculator` given a non-arithmetic expression (letters, `process`, etc.) | `safeEvalArithmetic` throws; the error string is returned to the agent loop as the tool result (LLM can recover or report). |
| Empty `tools` | Agent runs as a plain LLM (no tools bound) — a valid degenerate case. |
| Gateway tool call fails / times out | `callGatewayMethod` rejects; error surfaces as the tool's result content back into the loop. |
| Recursion limit (10) reached | `createReactAgent` throws `GraphRecursionError`; surfaced as a flow run error (consistent with other node throws). |
| Unknown built-in id in `tools` | Skipped (forward-compatible with future built-ins). |

---

## Security

- **`calculator`** never uses `eval`/`Function`/`new Function`. Input is gated by `^[0-9+\-*/().\s]+$` (rejects all identifiers) and parsed by a recursive-descent arithmetic parser. No code execution surface.
- **Gateway tools** call only `callGatewayMethod`, which goes through the authenticated gateway WS the same way `pluginAction` nodes do — no new auth surface, no arbitrary network access.
- **No HTTP-fetch tool** (explicitly out of scope) — avoids SSRF against internal services.
- `web_search` (Tavily) is a hosted API behind an API key; no SSRF surface.

---

## Testing

**langgraph-server (`npm test`):**
- `safeEvalArithmetic`: `2+3*4` → 14, `(1+2)*3` → 9, decimals; rejects `process.exit(1)`, `a+b`, `1;2` (throws).
- `current_time`: returns a parseable ISO string.
- `buildTools`: builtin ids resolve to tools with the right `name`; `web_search` omitted when `env.TAVILY_API_KEY` unset (and `onEvent` warn fired) / included when set; a `gateway` ref produces a tool that, when invoked, calls the injected `gatewayInvoke` with `{ input, runId, nodeId }` and returns its string.
- toolAgent runner with an injected `reactAgentFactory`: a fake agent whose `invoke` returns `{ messages: [...input, AIMessage('final')] }` → runner appends only the final message; `systemPrompt` is prepended to the messages the fake agent receives (assert via a capturing fake); `recursionLimit: 10` is passed in the config arg (assert via the capturing fake).
- `compileFlow` integration: `prompt → toolAgent → END` with injected `model` + `reactAgentFactory` runs the node and ends; `toolAgent` participates in fan-out and reachability/cycle checks (a cycle through it is rejected).
- Regression: all B1 + B2 tests still pass.
- Full `npm test` + `npx tsc --noEmit` green.

**Hub (`bun run check`):**
- `ToolAgentNode.svelte` svelte-autofixer-clean; toggling a built-in checkbox updates `data.tools`; adding a gateway tool appends the right `ToolRef`; removing works; drop produces the default shape. (No DnD unit harness — `bun run check` + manual.)

**Manual E2E:** build `prompt → toolAgent(model, system prompt, [calculator])`, ask "what is 137 * 24?", confirm the agent calls `calculator` and returns the result; add `web_search` (with key) and ask a current-events question; add a gateway tool and confirm it is invoked.

---

## Out of Scope (later)

- **Streaming intermediate tool steps** to the hub console (final message only, like every other node).
- **User-tunable recursion limit** (fixed at 10 in B3).
- **HTTP-fetch / arbitrary-URL tool** (SSRF risk).
- **Per-tool allowlist / auth config** beyond what `callGatewayMethod` already enforces.
- **Custom user-authored tools** (code).
- **Parallel multi-tool fan-out** beyond what `createReactAgent` does internally.

---

## Config Summary

- New optional env: `TAVILY_API_KEY` (enables the `web_search` built-in; absent → tool gracefully omitted).
- New runtime dep already present: `@langchain/tavily`, `zod`, `@langchain/langgraph` (prebuilt) — **no new package installs**.
- Reuses `resolveProviderModel`, `callGatewayMethod`, the existing run endpoints, and `PUBLIC_LANGGRAPH_FLOWS_URL`.
