# Flow Editor — Graph Foundation + Pure Nodes (Sub-feature B1)

**Date:** 2026-05-27
**Status:** Approved — pending spec review
**Repos:** `langgraph-server` (DAG compile + 2 node runners) · `minion_hub` (2 node components + palette)
**Series:** Sub-feature **B**, phase **B1** of 3. B (built-in LangChain/LangGraph nodes) decomposes into:
- **B1 (this spec):** generalize `compileFlow` to a connected DAG; fix the chaining input contract; add Template/Transform + Structured-output nodes.
- **B2:** Router / Conditional node (LangGraph `addConditionalEdges`).
- **B3:** Tool-calling LLM node (tool registry + agent loop).
Order: B1 → B2 → B3. B1 is the prerequisite for both.

(Sub-feature A — cascading Agent node — is DONE. Sub-feature C — flows-as-plugin — follows B.)

---

## Problem

`compileFlow` only supports **exactly one entry node → one execution node** (`__start__ → exec → __end__`). The flow editor cannot run multi-step chains (e.g. `prompt → llm → transform → agent`) or any graph topology. To support "built-in chain/graph nodes," the runtime must compile an arbitrary connected DAG of node-runners, and the per-node input contract must change so each node consumes the *previous* node's output (today the agent/pluginAction runners read "the last **human** message," which only works when the prompt is the sole message).

---

## Goal

1. **Generalized `compileFlow`:** compile a connected DAG of processing nodes wired by `flow` edges; the single entry node seeds the initial state; nodes with no outgoing `flow` edge terminate at `__end__`.
2. **Chaining input contract:** every processing node's input is the **content of the last message** in state; the node appends its output as a new message. This makes `prompt → llm → agent` feed the agent the llm's output.
3. **Two new pure nodes:**
   - **Template/Transform** — in-process text templating (no LLM).
   - **Structured output** — LLM constrained to a JSON schema (LangChain `withStructuredOutput`), result stringified downstream.

**Locked decision:** the last-message input contract replaces the "last human message" lookup in the agent and pluginAction runners. It is backward-safe for the existing single-node case (the prompt is both the last and the last-human message).

---

## Architecture

```
flow nodes + edges (from hub)
        │
        ▼  compileFlow (generalized)
 validateFlowShape:
   • exactly 1 entry (promptBox | trigger | pluginTrigger)
   • ≥1 processing node (llm | agent | pluginAction | transform | structured)
   • every processing node reachable from entry via 'flow' edges
   • DAG only (no cycles) ; single connected component
        │
        ▼  build StateGraph(MessagesAnnotation)
   for each processing node: addNode(node.id, buildNodeRunner(node))
   for each 'flow' edge s→t:
     • if s is the entry node → addEdge('__start__', t)
     • else                   → addEdge(s, t)
   for each processing node with NO outgoing 'flow' edge → addEdge(node.id, '__end__')
        │
        ▼  initialState = { messages: [HumanMessage(entryPrompt)] }
```

`buildNodeRunner(node)` dispatches on `node.type` and returns `(state) => Promise<{messages: BaseMessage[]}>`. Each runner reads `lastMessageContent(state)` as input and returns its output as a new message (MessagesAnnotation's reducer appends).

---

## Runtime Changes (`langgraph-server`, branch `dev`)

### 1. New types (`src/flow/types.ts`)

```ts
export type TransformNodeData = {
  template: string;   // e.g. "Summarize the following:\n{input}"
  label: string;
};

export type StructuredNodeData = {
  modelId: string;
  schema: string;     // JSON string: a JSON Schema object describing the desired output
  label: string;
};
```
Extend `FlowNode.type` union with `'transform' | 'structured'`; add the two data types to `FlowNode.data` union.

### 2. Input-contract helper (`compile-flow.ts`)

```ts
/** A processing node's input = the content of the most recent message in state. */
function lastMessageContent(state: typeof MessagesAnnotation.State): string {
  const last = state.messages[state.messages.length - 1];
  return last ? String(last.content) : '';
}
```

Update the **agent** and **pluginAction** runners to use `lastMessageContent(state)` instead of `[...messages].reverse().find(human)`. (LLM runner already invokes on the full message list — unchanged. Legacy `claude-*` agent path unchanged — it's an LLM call on the full list.)

### 3. Generalized `compileFlow` + `validateFlowShape`

Replace the "exactly 1 exec" logic. New `validateFlowShape(nodes, edges)`:
- `entryNodes = promptBox|trigger|pluginTrigger`; require exactly 1 (keep the existing "no trigger+promptBox" and ">1 trigger" rejections).
- `processingNodes = llm|agent|pluginAction|transform|structured`; require ≥1.
- Build adjacency from `flow` edges only. Require: every processing node is reachable from the entry node; the flow-edge graph among {entry ∪ processing} is acyclic (DFS cycle check → `UnsupportedFlowError` on cycle); a node may have multiple outgoing edges (fan-out) and multiple incoming (fan-in) — both allowed for B1 (MessagesAnnotation concatenates), but cycles are rejected.
- Reject unknown/island processing nodes not reachable from entry.

New `compileFlow`:
- Resolve `entryNode` + `promptValue` exactly as today (trigger/pluginTrigger require `initialPrompt`; promptBox uses `data.value`).
- `const graph = new StateGraph(MessagesAnnotation);`
- For each processing node: `graph.addNode(node.id, buildNodeRunner(node, opts, runId));`
- For each `flow` edge `s→t`: if `s === entryNode.id` → `graph.addEdge('__start__', t)`; else `graph.addEdge(s, t)`.
- For each processing node whose id is never a `flow` edge `source` → `graph.addEdge(node.id, '__end__')`.
- `graph.compile()`; return `{ graph, initialState }`.

Rename `buildExecNode` → `buildNodeRunner` (same signature) and add the two new branches.

### 4. New runners in `buildNodeRunner`

**transform** (pure):
```ts
if (node.type === 'transform') {
  const { template } = node.data as TransformNodeData;
  return async (state) => {
    const input = lastMessageContent(state);
    const text = template.replaceAll('{input}', input);
    return { messages: [new HumanMessage(text)] };
  };
}
```
(Appends a HumanMessage so a downstream LLM/agent treats the templated text as the new input.)

**structured** (LLM + schema):
```ts
if (node.type === 'structured') {
  const data = node.data as StructuredNodeData;
  const model: ChatModel = opts.model ?? resolveProviderModel(data.modelId ?? DEFAULT_MODEL);
  return async (state) => {
    let schema: Record<string, unknown>;
    try { schema = JSON.parse(data.schema || '{}'); }
    catch { throw new UnsupportedFlowError(`Structured node "${node.id}" has invalid JSON schema.`); }
    // model may be the real ChatModel (has withStructuredOutput) or an injected fake.
    const structuredModel = (model as unknown as {
      withStructuredOutput?: (s: unknown) => ChatModel;
    }).withStructuredOutput?.(schema) ?? model;
    const response = await structuredModel.invoke(state.messages);
    const content = typeof response.content === 'string'
      ? response.content
      : JSON.stringify(response.content ?? response);
    return { messages: [new AIMessage(content)] };
  };
}
```
(`ChatModel` interface gains an optional `withStructuredOutput?` so injected test models can omit it; the real provider model supports it. The output is stringified JSON appended as an AIMessage so downstream nodes can read it.)

### 5. `ChatModel` interface

Add the optional method so structured output type-checks against both real and fake models:
```ts
interface ChatModel {
  invoke(messages: BaseMessage[]): Promise<BaseMessage>;
  withStructuredOutput?(schema: unknown): ChatModel;
}
```

---

## Hub Changes (`minion_hub`, branch `dev`)

### 1. State types (`flow-editor.svelte.ts`)

Mirror the runtime: add `TransformNodeData {template,label}` + `StructuredNodeData {modelId,schema,label}`; extend `FlowNode.type` with `'transform'|'structured'` and `FlowNode.data` union.

### 2. Node components (`flow-editor/nodes/`)

- **`TransformNode.svelte`** — input handle (left) + output handle (right); a small `<textarea>` for the template (placeholder shows `{input}`); writes `data.template` on change via `setNodes`. Slate/neutral accent + a `Braces`/`Type` icon.
- **`StructuredNode.svelte`** — input + output handles; a model `<select>` (reuse the `models.list` + fallback pattern from `LLMNode.svelte`) and a `<textarea>` for the JSON schema; writes `data.modelId`/`data.schema`. Distinct accent (e.g. teal) + a `Braces` icon.

Both registered in `FlowCanvas.svelte` `nodeTypes` (`transform: TransformNode`, `structured: StructuredNode`).

### 3. Palette + drop (`FlowSidebar.svelte` + `FlowCanvas.svelte`)

- Add **Transform** and **Structured** palette items (a new "Logic"/"Transform" group, or alongside LLM in the existing section). Drag payloads `{ type: 'transform' }` / `{ type: 'structured' }`.
- `FlowCanvas` drop branches: `transform` → `{ template: '{input}', label: 'Transform' }`; `structured` → `{ modelId: 'claude-haiku-4-5-20251001', schema: '{\n  "type": "object",\n  "properties": {}\n}', label: 'Structured' }`.

(The canvas already supports connecting arbitrary nodes with `flow` edges via `handleConnect`, so multi-node chains are constructible once the runtime accepts them. No edge-model change.)

---

## Error Handling

| Scenario | Behavior |
|---|---|
| Flow has a cycle | `validateFlowShape` throws `UnsupportedFlowError('Flow graph has a cycle — loops are not supported.')`. |
| Processing node not reachable from entry | `UnsupportedFlowError('Node "<id>" is not connected to the entry node.')`. |
| 0 entry nodes / >1 entry | unchanged messages (exactly 1 entry required). |
| 0 processing nodes | `UnsupportedFlowError('Flow needs at least one processing node.')`. |
| Structured node invalid JSON schema | `UnsupportedFlowError` at runner build/run time (clear message). |
| Transform template with no `{input}` | Allowed — emits the literal template (valid use: a constant message). |
| trigger/pluginTrigger entry without `initialPrompt` | unchanged (throws as today). |

---

## Testing

**langgraph-server (`npm test`):**
- `validateFlowShape`: accepts `prompt→transform→llm` (3-node chain); accepts fan-out `prompt→{llm,transform}`; rejects a cycle; rejects an unreachable island node; still accepts the existing 1-entry→1-exec flows; still rejects trigger+promptBox.
- `compileFlow` chain: `prompt('Hi') → transform('X: {input}') → llm(fake echo)` runs in order; assert the llm sees `X: Hi` and the final message is the echo of it. (Confirms ordering + the last-message contract.)
- `compileFlow` transform: templating replaces `{input}`; appends a HumanMessage.
- `compileFlow` structured: injected fake model with `withStructuredOutput` returns a structured object → stringified into the final AIMessage; invalid schema throws.
- Regression: existing agent/pluginAction tests still pass with the `lastMessageContent` contract (single-message case).
- Full `npm test` + `npx tsc --noEmit` green.

**Hub (`bun run check`):**
- New node components validated via the Svelte autofixer; drop handler produces correct data shapes (verified via `bun run check` + manual). No DnD unit harness.

**Manual E2E:** build `prompt → transform → llm` in the editor, Run, see the templated text flow into the llm and a final reply; build `prompt → structured` with a small schema and see JSON output.

---

## Out of Scope (B2 / B3 / later)

- **Router / Conditional** node (B2) — branching via `addConditionalEdges`.
- **Tool-calling LLM** node (B3) — tool registry + agent loop.
- **Loops / cycles** — explicitly rejected in B1 (DAG only).
- **Parallel/merge semantics beyond MessagesAnnotation's default concat** — fan-out/fan-in compiles, but no explicit join/aggregation node in B1.
- **Per-node streaming of intermediate outputs to the console** — the existing run console shows the final result; richer per-node tracing is later.
- Drone execution (separate follow-on from sub-feature A).

---

## Config Summary

No new env vars. Reuses `resolveProviderModel` (OpenRouter/Anthropic), the existing run endpoints (`/flows/run`, `/flows/run-triggered`), and `PUBLIC_LANGGRAPH_FLOWS_URL`.
