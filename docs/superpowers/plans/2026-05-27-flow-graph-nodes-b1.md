# Graph Foundation + Pure Nodes (Sub-feature B1) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generalize `compileFlow` to compile a connected DAG of flow nodes (so multi-step chains run), change the per-node input contract to "last message in state," and add two pure built-in nodes — Template/Transform and Structured-output.

**Architecture:** `compileFlow` builds a `StateGraph(MessagesAnnotation)` with one graph node per processing node, wires `flow` edges (entry's out-edges → `__start__`, dangling nodes → `__end__`), rejects cycles/unreachable nodes. Each runner reads the last message's content as input and appends its output. The entry node seeds `initialState`.

**Tech Stack:** TypeScript strict. `langgraph-server/` (npm, vitest, `@langchain/langgraph@1.3.1`, `@langchain/core@1.1.48`, branch `dev`, meta-repo). `minion_hub/` (bun, SvelteKit 2 + Svelte 5 runes, `@xyflow/svelte`, branch `dev`).

**Spec:** `minion_hub/docs/superpowers/specs/2026-05-27-flow-graph-nodes-b1-design.md`

**Type sync:** `TransformNodeData`/`StructuredNodeData` and the `FlowNode` union additions (`'transform'|'structured'`) must be identical in `langgraph-server/src/flow/types.ts` (Task 1) and `minion_hub/.../flow-editor.svelte.ts` (Task 6).

---

## File Structure

**Runtime (`langgraph-server/`):**
- Modify `src/flow/types.ts` — TransformNodeData, StructuredNodeData, union (Task 1).
- Modify `src/flow/compile-flow.ts` — ChatModel iface (Task 1), `lastMessageContent` + agent/pluginAction contract (Task 2), generalized validate+compile+`buildNodeRunner` rename (Task 3), transform runner (Task 4), structured runner (Task 5).
- Modify `src/flow/compile-flow.test.ts` — all runtime tests.

**Hub (`minion_hub/`):**
- Modify `src/lib/state/features/flow-editor.svelte.ts` — types (Task 6).
- Create `src/lib/components/flow-editor/nodes/TransformNode.svelte`, `StructuredNode.svelte` (Task 7).
- Modify `src/lib/components/flow-editor/FlowCanvas.svelte` — nodeTypes + drop (Task 7, 8).
- Modify `src/lib/components/flow-editor/FlowSidebar.svelte` — palette (Task 8).

---

## RUNTIME TASKS (`langgraph-server/`, branch `dev`, run `npm test`)

### Task 1: New node-data types + ChatModel interface

**Files:**
- Modify: `src/flow/types.ts`
- Modify: `src/flow/compile-flow.ts` (the `ChatModel` interface, ~lines 59-61)

- [ ] **Step 1: Add types to `src/flow/types.ts`**

After `LLMNodeData` (and before `TriggerNodeData` or near the other data types), add:
```ts
export type TransformNodeData = {
  template: string;
  label: string;
};

export type StructuredNodeData = {
  modelId: string;
  schema: string;
  label: string;
};
```
Extend the `FlowNode` type union:
```ts
  type: 'agent' | 'promptBox' | 'llm' | 'trigger' | 'pluginTrigger' | 'pluginAction' | 'transform' | 'structured';
```
and the `data` union — add `| TransformNodeData | StructuredNodeData`.

- [ ] **Step 2: Extend `ChatModel` in `src/flow/compile-flow.ts`**

```ts
interface ChatModel {
  invoke(messages: BaseMessage[]): Promise<BaseMessage>;
  withStructuredOutput?(schema: unknown): ChatModel;
}
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors (types only added; existing code still compiles).

- [ ] **Step 4: Commit**

```bash
git add langgraph-server/src/flow/types.ts langgraph-server/src/flow/compile-flow.ts
git commit -m "feat(flow): add transform/structured node types + ChatModel.withStructuredOutput"
```
(If running git inside `langgraph-server/`, use `src/flow/...` paths. Same for all runtime tasks.)

---

### Task 2: `lastMessageContent` contract for agent + pluginAction

**Files:**
- Modify: `src/flow/compile-flow.ts`
- Modify: `src/flow/compile-flow.test.ts`

Context: today the agent and pluginAction runners read the last **human** message. Change both to read the last message of any kind so chains compose. This is backward-safe (single-node flows have only the human prompt as the last message).

- [ ] **Step 1: Write the failing test**

Append to `src/flow/compile-flow.test.ts`:
```ts
describe('chaining input contract', () => {
  it('agent node reads the latest message (not just the last human)', async () => {
    // prompt -> llm (appends an AIMessage) -> agent : the agent must receive the AIMessage content.
    const fakeModel = { async invoke() { return new AIMessage('LLM_OUT'); } };
    const seen: string[] = [];
    const fakeGateway = { async sendAgentTurn(_id: string, p: string) { seen.push(p); return 'AGENT_OUT'; } };
    const llm: FlowNode = { id: 'l1', type: 'llm', position: { x: 0, y: 0 }, data: { modelId: 'm', label: 'LLM' } };
    const ag: FlowNode = { id: 'a2', type: 'agent', position: { x: 0, y: 0 }, data: { agentKind: 'custom', agentId: 'PANIK', label: 'PANIK', sessionMode: 'ephemeral' } as never };
    const e1: FlowEdge = { id: 'e1', source: 'p1', sourceHandle: 'o', target: 'l1', targetHandle: 'i', type: 'flow' };
    const e2: FlowEdge = { id: 'e2', source: 'l1', sourceHandle: 'o', target: 'a2', targetHandle: 'i', type: 'flow' };
    const { graph, initialState } = compileFlow([prompt, llm, ag], [e1, e2], { model: fakeModel, gatewayClient: fakeGateway });
    await graph.invoke(initialState);
    expect(seen).toEqual(['LLM_OUT']); // agent saw the llm's output, not 'Hello'
  });
});
```
(This test also depends on Task 3's generalized compile to run a 3-node chain. If you are doing strict task isolation, write this test now, watch it fail, and it will PASS after Task 3 — note that in your report. Alternatively, implement Task 2's contract change here and a smaller unit check, then this full-chain assertion goes green in Task 3. Pragmatic approach: keep this test, implement the contract change in Step 3 below, and let it fully pass once Task 3 lands. Mark it `it.skip` if it cannot pass before Task 3, then un-skip in Task 3.)

- [ ] **Step 2: Run it**

Run: `npm test -- src/flow/compile-flow.test.ts`
Expected: FAIL (3-node chain not yet supported / agent reads wrong message).

- [ ] **Step 3: Add `lastMessageContent` + update the two runners**

Add the helper near the top of the runner section in `compile-flow.ts`:
```ts
/** A processing node's input = the content of the most recent message in state. */
function lastMessageContent(state: typeof MessagesAnnotation.State): string {
  const last = state.messages[state.messages.length - 1];
  return last ? String(last.content) : '';
}
```
In the **pluginAction** runner, replace the `lastHuman` lookup + guard with:
```ts
    return async (state) => {
      const input = lastMessageContent(state);
      const reply = await invoke(data.method, { input, runId, nodeId: node.id });
      return { messages: [new AIMessage(reply)] };
    };
```
In the **agent** (real gateway) runner, replace the `lastHuman` lookup + guard with:
```ts
  return async (state) => {
    const prompt = lastMessageContent(state);
    const reply = await gc.sendAgentTurn(
      agentData.agentId, prompt, agentData.sessionMode ?? 'ephemeral', runId, node.id,
    );
    return { messages: [new AIMessage(reply)] };
  };
```
(Remove the now-unused "received no human message" throws. The llm and legacy-claude paths invoke on the full message list — leave them unchanged.)

- [ ] **Step 4: Run tests**

Run: `npm test -- src/flow/compile-flow.test.ts`
Expected: existing single-node agent/pluginAction tests still PASS (the prompt is the last message). The new chain test PASSES only after Task 3 — if it's `it.skip`ped, keep it skipped here; otherwise expect it to still fail until Task 3.

- [ ] **Step 5: Commit**

```bash
git add langgraph-server/src/flow/compile-flow.ts langgraph-server/src/flow/compile-flow.test.ts
git commit -m "refactor(flow): agent/pluginAction read last message (chaining contract)"
```

---

### Task 3: Generalized `validateFlowShape` + `compileFlow` (DAG compile)

**Files:**
- Modify: `src/flow/compile-flow.ts`
- Modify: `src/flow/compile-flow.test.ts`

Context: this is the core change. Replace the "exactly 1 exec" validation and the trivial `__start__→exec→__end__` graph with a general DAG compile. Rename `buildExecNode` → `buildNodeRunner` (keep its existing branches). Un-skip the Task 2 chain test.

- [ ] **Step 1: Write the failing tests**

Append to `src/flow/compile-flow.test.ts`:
```ts
describe('validateFlowShape — graph (B1)', () => {
  const llm2: FlowNode = { id: 'l2', type: 'llm', position: { x: 0, y: 0 }, data: { modelId: 'm', label: 'LLM2' } };
  it('accepts a 3-node chain prompt->llm->llm2', () => {
    const e1: FlowEdge = { id: 'e1', source: 'p1', sourceHandle: 'o', target: 'l1', targetHandle: 'i', type: 'flow' };
    const e2: FlowEdge = { id: 'e2', source: 'l1', sourceHandle: 'o', target: 'l2', targetHandle: 'i', type: 'flow' };
    expect(() => validateFlowShape([prompt, llmNode, llm2], [e1, e2])).not.toThrow();
  });
  it('rejects a cycle', () => {
    const e1: FlowEdge = { id: 'e1', source: 'p1', sourceHandle: 'o', target: 'l1', targetHandle: 'i', type: 'flow' };
    const e2: FlowEdge = { id: 'e2', source: 'l1', sourceHandle: 'o', target: 'l2', targetHandle: 'i', type: 'flow' };
    const e3: FlowEdge = { id: 'e3', source: 'l2', sourceHandle: 'o', target: 'l1', targetHandle: 'i', type: 'flow' };
    expect(() => validateFlowShape([prompt, llmNode, llm2], [e1, e2, e3])).toThrow(UnsupportedFlowError);
  });
  it('rejects an unreachable processing node', () => {
    const e1: FlowEdge = { id: 'e1', source: 'p1', sourceHandle: 'o', target: 'l1', targetHandle: 'i', type: 'flow' };
    expect(() => validateFlowShape([prompt, llmNode, llm2], [e1])).toThrow(UnsupportedFlowError);
  });
  it('rejects zero processing nodes', () => {
    expect(() => validateFlowShape([prompt], [])).toThrow(UnsupportedFlowError);
  });
  it('still accepts the classic single prompt->agent flow', () => {
    expect(() => validateFlowShape([prompt, agent], [edge])).not.toThrow();
  });
});

describe('compileFlow — chain ordering (B1)', () => {
  it('runs prompt->transformLikeLLM->llm in order, passing outputs forward', async () => {
    // Use two llm nodes with distinct fake behavior to prove sequencing.
    const calls: string[] = [];
    const fakeModel = {
      async invoke(msgs: BaseMessage[]) {
        const inp = String(msgs[msgs.length - 1].content);
        calls.push(inp);
        return new AIMessage(`<${inp}>`);
      },
    };
    const llm2: FlowNode = { id: 'l2', type: 'llm', position: { x: 0, y: 0 }, data: { modelId: 'm', label: 'LLM2' } };
    const e1: FlowEdge = { id: 'e1', source: 'p1', sourceHandle: 'o', target: 'l1', targetHandle: 'i', type: 'flow' };
    const e2: FlowEdge = { id: 'e2', source: 'l1', sourceHandle: 'o', target: 'l2', targetHandle: 'i', type: 'flow' };
    const { graph, initialState } = compileFlow([prompt, llmNode, llm2], [e1, e2], { model: fakeModel });
    const result = await graph.invoke(initialState);
    expect(calls[0]).toBe('Hello');
    expect(calls[1]).toBe('<Hello>');
    expect(result.messages[result.messages.length - 1].content).toBe('<<Hello>>');
  });
});
```
Also: if you `it.skip`ped the Task 2 chain test, change it to `it(...)` now.

- [ ] **Step 2: Run, verify fail**

Run: `npm test -- src/flow/compile-flow.test.ts`
Expected: FAIL (validateFlowShape still demands exactly 1 exec; compileFlow builds only `exec`).

- [ ] **Step 3: Rewrite `validateFlowShape`**

```ts
const ENTRY_TYPES = ['promptBox', 'trigger', 'pluginTrigger'] as const;
const PROCESSING_TYPES = ['llm', 'agent', 'pluginAction', 'transform', 'structured'] as const;

export function validateFlowShape(nodes: FlowNode[], edges: FlowEdge[]): void {
  const prompts = nodes.filter((n) => n.type === 'promptBox');
  const triggers = nodes.filter((n) => n.type === 'trigger' || n.type === 'pluginTrigger');
  const processing = nodes.filter((n) => (PROCESSING_TYPES as readonly string[]).includes(n.type));

  if (prompts.length > 0 && triggers.length > 0) {
    throw new UnsupportedFlowError('A flow cannot have both a trigger and a prompt box.');
  }
  const entryNodes = [...prompts, ...triggers];
  if (entryNodes.length !== 1) {
    throw new UnsupportedFlowError(`Expected exactly 1 prompt or trigger node, found ${entryNodes.length}.`);
  }
  if (processing.length < 1) {
    throw new UnsupportedFlowError('Flow needs at least one processing node.');
  }

  const entry = entryNodes[0];
  const flowEdges = edges.filter((e) => e.type === 'flow');
  const adj = new Map<string, string[]>();
  for (const e of flowEdges) {
    if (!adj.has(e.source)) adj.set(e.source, []);
    adj.get(e.source)!.push(e.target);
  }

  // Reachability from entry.
  const reachable = new Set<string>();
  const stack = [entry.id];
  while (stack.length) {
    const cur = stack.pop()!;
    if (reachable.has(cur)) continue;
    reachable.add(cur);
    for (const next of adj.get(cur) ?? []) stack.push(next);
  }
  for (const p of processing) {
    if (!reachable.has(p.id)) {
      throw new UnsupportedFlowError(`Node "${p.id}" is not connected to the entry node.`);
    }
  }

  // Cycle detection (DFS over the flow-edge graph).
  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Map<string, number>();
  const visit = (id: string): void => {
    color.set(id, GRAY);
    for (const next of adj.get(id) ?? []) {
      const c = color.get(next) ?? WHITE;
      if (c === GRAY) throw new UnsupportedFlowError('Flow graph has a cycle — loops are not supported.');
      if (c === WHITE) visit(next);
    }
    color.set(id, BLACK);
  };
  for (const n of nodes) if ((color.get(n.id) ?? WHITE) === WHITE) visit(n.id);
}
```

- [ ] **Step 4: Rewrite `compileFlow` to build the DAG**

```ts
export function compileFlow(nodes: FlowNode[], edges: FlowEdge[], opts: CompileOptions = {}) {
  validateFlowShape(nodes, edges);

  const entryNode = nodes.find(
    (n) => n.type === 'promptBox' || n.type === 'trigger' || n.type === 'pluginTrigger',
  )!;
  const runId = randomUUID();

  let promptValue: string;
  if (entryNode.type === 'trigger' || entryNode.type === 'pluginTrigger') {
    if (!opts.initialPrompt) {
      throw new UnsupportedFlowError(
        'Trigger node requires an initialPrompt (event payload) — call via /flows/run-triggered.',
      );
    }
    promptValue = opts.initialPrompt;
  } else {
    promptValue = (entryNode.data as PromptBoxData).value ?? '';
  }

  const processing = nodes.filter((n) =>
    n.type === 'llm' || n.type === 'agent' || n.type === 'pluginAction' ||
    n.type === 'transform' || n.type === 'structured',
  );
  const flowEdges = edges.filter((e) => e.type === 'flow');

  // Build the graph. Node names are dynamic strings; the StateGraph generic is
  // widened to accept them (LangGraph 1.x types node names as a literal union,
  // so we keep a loosely-typed builder reference for the dynamic adds).
  const builder = new StateGraph(MessagesAnnotation);
  type AnyGraph = {
    addNode: (name: string, fn: (s: typeof MessagesAnnotation.State) => Promise<{ messages: BaseMessage[] }>) => void;
    addEdge: (from: string, to: string) => void;
    compile: () => ReturnType<typeof builder.compile>;
  };
  const g = builder as unknown as AnyGraph;

  for (const node of processing) {
    g.addNode(node.id, buildNodeRunner(node, opts, runId));
  }
  const hasOutgoing = new Set(flowEdges.map((e) => e.source));
  for (const e of flowEdges) {
    if (e.source === entryNode.id) g.addEdge('__start__', e.target);
    else g.addEdge(e.source, e.target);
  }
  for (const node of processing) {
    if (!hasOutgoing.has(node.id)) g.addEdge(node.id, '__end__');
  }

  const graph = g.compile();
  const initialState = { messages: [new HumanMessage(promptValue)] };
  return { graph, initialState };
}
```
(If `npx tsc --noEmit` complains about the `AnyGraph` cast or `__start__`/`__end__` string literals, prefer importing `START`/`END` from `@langchain/langgraph` and using those constants; resolve the node-name typing against the real 1.3.1 typings without using `any` — a single localized `as unknown as` cast on the builder is acceptable, as shown.)

- [ ] **Step 5: Rename `buildExecNode` → `buildNodeRunner`**

Rename the function and update its call site (now inside the loop above). Keep its existing branches (pluginAction, llm, legacy-claude agent, real agent) exactly as Task 2 left them.

- [ ] **Step 6: Run tests**

Run: `npm test -- src/flow/compile-flow.test.ts`
Expected: PASS — new graph/chain tests + the un-skipped Task 2 chain test + all existing tests.

- [ ] **Step 7: Full suite + typecheck, then commit**

Run: `npm test && npx tsc --noEmit` → all green.
```bash
git add langgraph-server/src/flow/compile-flow.ts langgraph-server/src/flow/compile-flow.test.ts
git commit -m "feat(flow): compile a connected DAG of nodes (multi-step chains)"
```

---

### Task 4: Transform node runner

**Files:**
- Modify: `src/flow/compile-flow.ts` (add a branch in `buildNodeRunner`)
- Modify: `src/flow/compile-flow.test.ts`

- [ ] **Step 1: Write the failing test**

Append:
```ts
describe('compileFlow — transform node', () => {
  it('templates {input} with the last message and feeds the next node', async () => {
    const seen: string[] = [];
    const fakeModel = { async invoke(msgs: BaseMessage[]) { seen.push(String(msgs[msgs.length - 1].content)); return new AIMessage('done'); } };
    const transform: FlowNode = { id: 't1', type: 'transform', position: { x: 0, y: 0 }, data: { template: 'Q: {input}', label: 'T' } as never };
    const e1: FlowEdge = { id: 'e1', source: 'p1', sourceHandle: 'o', target: 't1', targetHandle: 'i', type: 'flow' };
    const e2: FlowEdge = { id: 'e2', source: 't1', sourceHandle: 'o', target: 'l1', targetHandle: 'i', type: 'flow' };
    const { graph, initialState } = compileFlow([prompt, transform, llmNode], [e1, e2], { model: fakeModel });
    await graph.invoke(initialState);
    expect(seen).toEqual(['Q: Hello']);
  });
});
```

- [ ] **Step 2: Run, verify fail**

Run: `npm test -- src/flow/compile-flow.test.ts` → FAIL (transform falls through to agent path / wrong output).

- [ ] **Step 3: Add the transform branch at the top of `buildNodeRunner`**

```ts
  if (node.type === 'transform') {
    const { template } = node.data as TransformNodeData;
    return async (state) => {
      const text = template.replaceAll('{input}', lastMessageContent(state));
      return { messages: [new HumanMessage(text)] };
    };
  }
```
(Import `TransformNodeData` from `./types.js`.)

- [ ] **Step 4: Run, verify pass**

Run: `npm test -- src/flow/compile-flow.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add langgraph-server/src/flow/compile-flow.ts langgraph-server/src/flow/compile-flow.test.ts
git commit -m "feat(flow): Template/Transform node (in-process {input} templating)"
```

---

### Task 5: Structured-output node runner

**Files:**
- Modify: `src/flow/compile-flow.ts`
- Modify: `src/flow/compile-flow.test.ts`

- [ ] **Step 1: Write the failing tests**

Append:
```ts
describe('compileFlow — structured node', () => {
  it('uses withStructuredOutput and stringifies the result', async () => {
    const fakeModel = {
      invoke: async () => new AIMessage('ignored'),
      withStructuredOutput() {
        return { async invoke() { return new AIMessage('{"name":"Ada"}'); } } as never;
      },
    };
    const structured: FlowNode = { id: 's1', type: 'structured', position: { x: 0, y: 0 }, data: { modelId: 'm', schema: '{"type":"object"}', label: 'S' } as never };
    const e1: FlowEdge = { id: 'e1', source: 'p1', sourceHandle: 'o', target: 's1', targetHandle: 'i', type: 'flow' };
    const { graph, initialState } = compileFlow([prompt, structured], [e1], { model: fakeModel });
    const result = await graph.invoke(initialState);
    expect(result.messages[result.messages.length - 1].content).toBe('{"name":"Ada"}');
  });
  it('throws on invalid JSON schema', () => {
    const structured: FlowNode = { id: 's1', type: 'structured', position: { x: 0, y: 0 }, data: { modelId: 'm', schema: 'not json', label: 'S' } as never };
    const e1: FlowEdge = { id: 'e1', source: 'p1', sourceHandle: 'o', target: 's1', targetHandle: 'i', type: 'flow' };
    const { graph, initialState } = compileFlow([prompt, structured], [e1], { model: { invoke: async () => new AIMessage('x') } });
    return expect(graph.invoke(initialState)).rejects.toThrow(UnsupportedFlowError);
  });
});
```
(Note: invalid-schema throws at runner *execution* time, so the second test asserts the rejected `graph.invoke` promise.)

- [ ] **Step 2: Run, verify fail**

Run: `npm test -- src/flow/compile-flow.test.ts` → FAIL.

- [ ] **Step 3: Add the structured branch in `buildNodeRunner`**

```ts
  if (node.type === 'structured') {
    const data = node.data as StructuredNodeData;
    const model: ChatModel = opts.model ?? resolveProviderModel(data.modelId ?? DEFAULT_MODEL);
    return async (state) => {
      let schema: Record<string, unknown>;
      try { schema = JSON.parse(data.schema || '{}'); }
      catch { throw new UnsupportedFlowError(`Structured node "${node.id}" has invalid JSON schema.`); }
      const structuredModel = model.withStructuredOutput?.(schema) ?? model;
      const response = await structuredModel.invoke(state.messages);
      const content = typeof response.content === 'string'
        ? response.content
        : JSON.stringify(response.content ?? response);
      return { messages: [new AIMessage(content)] };
    };
  }
```
(Import `StructuredNodeData` from `./types.js`. The schema parse throws inside the async runner so it surfaces as a rejected `graph.invoke`.)

- [ ] **Step 4: Run, verify pass + full suite + typecheck**

Run: `npm test && npx tsc --noEmit` → all PASS.

- [ ] **Step 5: Commit**

```bash
git add langgraph-server/src/flow/compile-flow.ts langgraph-server/src/flow/compile-flow.test.ts
git commit -m "feat(flow): Structured-output node (withStructuredOutput + JSON schema)"
```

---

## HUB TASKS (`minion_hub/`, branch `dev`, run `bun run check`)

### Task 6: Hub node-data types

**Files:**
- Modify: `src/lib/state/features/flow-editor.svelte.ts`

- [ ] **Step 1: Add the types (mirror runtime)**

After `LLMNodeData`:
```ts
export type TransformNodeData = {
  template: string;
  label: string;
};

export type StructuredNodeData = {
  modelId: string;
  schema: string;
  label: string;
};
```
Extend `FlowNode.type` with `| 'transform' | 'structured'` and the `data` union with `| TransformNodeData | StructuredNodeData`.

- [ ] **Step 2: Type-check**

Run: `bun run check` → no NEW errors referencing flow-editor.svelte.ts.

- [ ] **Step 3: Commit**

```bash
git add src/lib/state/features/flow-editor.svelte.ts
git commit -m "feat(flow-editor): add transform/structured node data types"
```

---

### Task 7: TransformNode + StructuredNode components

**Files:**
- Create: `src/lib/components/flow-editor/nodes/TransformNode.svelte`
- Create: `src/lib/components/flow-editor/nodes/StructuredNode.svelte`
- Modify: `src/lib/components/flow-editor/FlowCanvas.svelte` (imports + nodeTypes)

Context: mirror `LLMNode.svelte` (input handle left + output handle right; the `models.list` fetch + fallback for StructuredNode's model select) and the `setNodes` update pattern. Validate both with the Svelte MCP autofixer.

- [ ] **Step 1: Create `TransformNode.svelte`**

```svelte
<script lang="ts">
  import { Handle, Position } from '@xyflow/svelte';
  import type { NodeProps } from '@xyflow/svelte';
  import type { TransformNodeData } from '$lib/state/features/flow-editor.svelte';
  import { flowEditorState, setNodes } from '$lib/state/features/flow-editor.svelte';
  import { Braces } from 'lucide-svelte';

  let { data, id }: NodeProps & { data: TransformNodeData } = $props();

  function handleTemplate(e: Event) {
    const template = (e.target as HTMLTextAreaElement).value;
    const next = flowEditorState.nodes.map((n) =>
      n.id === id ? { ...n, data: { ...n.data, template } } : n,
    );
    setNodes(next);
  }
</script>

<Handle type="target" position={Position.Left} id="in" class="!w-3 !h-3 !border-2 !border-slate-400 !bg-slate-900" />
<Handle type="source" position={Position.Right} id="out" class="!w-3 !h-3 !border-2 !border-slate-400 !bg-slate-900" />

<div class="relative bg-bg2 border rounded-xl px-4 py-3 min-w-48 max-w-64 shadow-lg select-none border-border hover:border-border/80">
  <div class="flex items-center gap-2 mb-1">
    <div class="w-6 h-6 rounded-md bg-slate-500/20 flex items-center justify-center shrink-0">
      <Braces size={12} class="text-slate-300" />
    </div>
    <span class="text-xs font-semibold text-foreground truncate">{data.label || 'Transform'}</span>
  </div>
  <textarea
    class="w-full text-[10px] bg-bg3 border border-border rounded px-1 py-0.5 text-foreground resize-y min-h-12"
    placeholder="Template — use {'{input}'} for the upstream output"
    value={data.template}
    onclick={(e) => e.stopPropagation()}
    oninput={handleTemplate}
  ></textarea>
</div>
```

- [ ] **Step 2: Create `StructuredNode.svelte`**

```svelte
<script lang="ts">
  import { Handle, Position } from '@xyflow/svelte';
  import type { NodeProps } from '@xyflow/svelte';
  import type { StructuredNodeData } from '$lib/state/features/flow-editor.svelte';
  import { flowEditorState, setNodes } from '$lib/state/features/flow-editor.svelte';
  import { sendRequest } from '$lib/services/gateway.svelte';
  import { Braces } from 'lucide-svelte';
  import { onMount } from 'svelte';

  let { data, id }: NodeProps & { data: StructuredNodeData } = $props();

  interface ModelItem { id: string; name: string }
  let models = $state<ModelItem[]>([]);
  const FALLBACK_MODELS: ModelItem[] = [
    { id: 'claude-haiku-4-5-20251001', name: 'Claude Haiku 4.5' },
    { id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6' },
  ];

  onMount(async () => {
    try {
      const res = (await sendRequest('models.list', {})) as { models?: ModelItem[] } | null;
      models = res?.models?.length ? res.models : FALLBACK_MODELS;
    } catch {
      models = FALLBACK_MODELS;
    }
  });

  function patch(partial: Partial<StructuredNodeData>) {
    const next = flowEditorState.nodes.map((n) =>
      n.id === id ? { ...n, data: { ...n.data, ...partial } } : n,
    );
    setNodes(next);
  }
</script>

<Handle type="target" position={Position.Left} id="in" class="!w-3 !h-3 !border-2 !border-teal-400 !bg-teal-900" />
<Handle type="source" position={Position.Right} id="out" class="!w-3 !h-3 !border-2 !border-teal-400 !bg-teal-900" />

<div class="relative bg-bg2 border rounded-xl px-4 py-3 min-w-48 max-w-64 shadow-lg select-none border-border hover:border-border/80">
  <div class="flex items-center gap-2 mb-1">
    <div class="w-6 h-6 rounded-md bg-teal-500/20 flex items-center justify-center shrink-0">
      <Braces size={12} class="text-teal-300" />
    </div>
    <span class="text-xs font-semibold text-foreground truncate">{data.label || 'Structured'}</span>
  </div>
  <select
    class="w-full text-[10px] bg-bg3 border border-border rounded px-1 py-0.5 text-foreground mb-1"
    value={data.modelId}
    onclick={(e) => e.stopPropagation()}
    onchange={(e) => patch({ modelId: (e.target as HTMLSelectElement).value })}
  >
    {#each models as mdl (mdl.id)}
      <option value={mdl.id}>{mdl.name ?? mdl.id}</option>
    {/each}
  </select>
  <textarea
    class="w-full text-[10px] bg-bg3 border border-border rounded px-1 py-0.5 text-foreground resize-y min-h-12 font-mono"
    placeholder={'{ "type": "object", "properties": {} }'}
    value={data.schema}
    onclick={(e) => e.stopPropagation()}
    oninput={(e) => patch({ schema: (e.target as HTMLTextAreaElement).value })}
  ></textarea>
</div>
```

- [ ] **Step 3: Register both in `FlowCanvas.svelte`**

Add imports after the other node imports:
```ts
  import TransformNode from './nodes/TransformNode.svelte';
  import StructuredNode from './nodes/StructuredNode.svelte';
```
Add to `nodeTypes`:
```ts
    transform: TransformNode,
    structured: StructuredNode,
```

- [ ] **Step 4: Validate with the Svelte autofixer**

Run the Svelte MCP autofixer on both new components; fix issues; re-run clean.

- [ ] **Step 5: Type-check**

Run: `bun run check` → no NEW errors referencing the two components or FlowCanvas.svelte.

- [ ] **Step 6: Commit**

```bash
git add src/lib/components/flow-editor/nodes/TransformNode.svelte src/lib/components/flow-editor/nodes/StructuredNode.svelte src/lib/components/flow-editor/FlowCanvas.svelte
git commit -m "feat(flow-editor): Transform + Structured node components"
```

---

### Task 8: Palette items + drop handler

**Files:**
- Modify: `src/lib/components/flow-editor/FlowSidebar.svelte`
- Modify: `src/lib/components/flow-editor/FlowCanvas.svelte`

- [ ] **Step 1: FlowSidebar — add `addTransform`/`addStructured` + palette items**

In the script, add (mirroring `addLLMNode`):
```ts
  function addTransform() {
    const node: FlowNode = {
      id: makeId(), type: 'transform', position: getDropPosition(),
      data: { template: '{input}', label: 'Transform' } satisfies TransformNodeData,
    };
    setNodes([...flowEditorState.nodes, node]);
  }
  function addStructured() {
    const node: FlowNode = {
      id: makeId(), type: 'structured', position: getDropPosition(),
      data: { modelId: 'claude-haiku-4-5-20251001', schema: '{\n  "type": "object",\n  "properties": {}\n}', label: 'Structured' } satisfies StructuredNodeData,
    };
    setNodes([...flowEditorState.nodes, node]);
  }
```
(Add `type TransformNodeData, type StructuredNodeData` to the existing import from `$lib/state/features/flow-editor.svelte`. Import a `Braces` icon from lucide-svelte.)

Widen `handleDragStart`'s payload union to include `'transform'`/`'structured'`:
```ts
  function handleDragStart(
    e: DragEvent,
    payload:
      | { type: 'agent' | 'promptBox' | 'llm' | 'trigger' | 'transform' | 'structured'; agentId?: string; label?: string }
      | { type: 'pluginTrigger' | 'pluginAction'; descriptor: FlowNodeDescriptor },
  ) { /* unchanged body */ }
```

In the EXPANDED Inputs section, after the LLM button, add two buttons (Transform, Structured) following the existing button markup, with `onclick={addTransform}` / `onclick={addStructured}`, `ondragstart={(e) => handleDragStart(e, { type: 'transform' })}` / `{ type: 'structured' }`, a `Braces` icon, slate/teal accent chips, and labels "Transform" / "Structured" with subtitles "Template text" / "JSON output".

In the COLLAPSED view, add two `Braces` icon buttons after the LLM icon (same dragstart payloads).

- [ ] **Step 2: FlowCanvas — drop branches**

Widen the `handleDrop` payload `type` union to include `'transform' | 'structured'`. Add `type TransformNodeData, type StructuredNodeData` to the imports. After the `llm` branch, add:
```ts
    } else if (payload.type === 'transform') {
      const node: FlowNode = {
        id: makeId(), type: 'transform', position,
        data: { template: '{input}', label: 'Transform' } satisfies TransformNodeData,
      };
      setNodes([...flowEditorState.nodes, node]);
    } else if (payload.type === 'structured') {
      const node: FlowNode = {
        id: makeId(), type: 'structured', position,
        data: { modelId: 'claude-haiku-4-5-20251001', schema: '{\n  "type": "object",\n  "properties": {}\n}', label: 'Structured' } satisfies StructuredNodeData,
      };
      setNodes([...flowEditorState.nodes, node]);
    }
```

- [ ] **Step 3: Validate with the Svelte autofixer**

Run the autofixer on FlowSidebar.svelte + FlowCanvas.svelte; fix; re-run clean.

- [ ] **Step 4: Type-check**

Run: `bun run check` → no NEW errors referencing these files.

- [ ] **Step 5: Manual verification**

With the hub dev server RESTARTED (per the dev-server HMR gotcha) and the langgraph server running: open the flow editor → drag Prompt → Transform → LLM, connect them, Run → confirm the templated text reaches the LLM and a reply returns. Drag Prompt → Structured with a small schema → Run → JSON output. If you can't run the servers, say so.

- [ ] **Step 6: Commit**

```bash
git add src/lib/components/flow-editor/FlowSidebar.svelte src/lib/components/flow-editor/FlowCanvas.svelte
git commit -m "feat(flow-editor): Transform + Structured palette items + drop handling"
```

---

## Final Verification (after all tasks)

- [ ] Runtime: `npm test && npx tsc --noEmit` (DAG/chain/transform/structured tests + all prior green).
- [ ] Hub: `bun run check` (no new errors; new components autofixer-clean).
- [ ] Manual E2E: `prompt → transform → llm` chain runs with templated input; `prompt → structured` returns JSON; existing single-node flows still run; a cycle shows the "loops not supported" error.
- [ ] Dispatch a final cross-repo code review.

---

## Notes for the Executor

- **Do not bump any package version** — Changesets owns versioning.
- **Commit scope**: stage only the files named per task; never `git add -A`.
- **Branches**: runtime `dev` (meta-repo), hub `dev`. Don't switch/merge branches.
- **Run git from the correct repo root** — the hub is a separate repo from the meta-repo; if a commit fails with "beyond a symbolic link", `cd` into the repo root first.
- **Push is blocked** (SSH identity) — commits stay local.
- **Svelte**: use the autofixer; Svelte 5 runes only.
- **StateGraph typing**: dynamic string node names need a localized cast (shown in Task 3) — resolve against `@langchain/langgraph@1.3.1` typings; prefer `START`/`END` constants if string literals don't type-check; do NOT use `any` (use `as unknown as <type>`).
- The Task 2 chain test depends on Task 3 — `it.skip` it in Task 2 and un-skip in Task 3 if strict per-task green is required.
