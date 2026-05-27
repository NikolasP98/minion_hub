# Router / Conditional Node (Sub-feature B2) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `router` node that routes the flow to one of N labeled branches (or a `default`) by deterministic rules (first-match-wins) or LLM label-classification, compiled via LangGraph `addConditionalEdges`.

**Architecture:** The router is a pass-through graph node; its outgoing `flow` edges (keyed by `sourceHandle` = branch id) become a `pathMap`, and a `routeFn` (rule eval or LLM classify, clamped to connected handles) selects the branch. Builds on B1's DAG `compileFlow`.

**Tech Stack:** TypeScript strict. `langgraph-server/` (npm, vitest, `@langchain/langgraph@1.3.1`, branch `dev`, meta-repo). `minion_hub/` (bun, SvelteKit 2 + Svelte 5 runes, `@xyflow/svelte`, branch `dev`).

**Spec:** `minion_hub/docs/superpowers/specs/2026-05-27-flow-router-node-b2-design.md`

**Type sync:** `RouterRuleOp` / `RouterBranch` / `RouterNodeData` and the `'router'` type-union addition must be identical in `langgraph-server/src/flow/types.ts` (Task 1) and `minion_hub/.../flow-editor.svelte.ts` (Task 4).

---

## File Structure

**Runtime (`langgraph-server/`):**
- Modify `src/flow/types.ts` — router types + union (Task 1).
- Modify `src/flow/compile-flow.ts` — `'router'` in PROCESSING_TYPES + processing filter + pass-through runner (Task 1); `matchesRule`/`classifyWithLlm`/`buildRouterRoute` (Task 2); edge-phase restructure + `addConditionalEdges` (Task 3).
- Modify `src/flow/compile-flow.test.ts` — Task 2 + Task 3 tests.

**Hub (`minion_hub/`):**
- Modify `src/lib/state/features/flow-editor.svelte.ts` — types (Task 4).
- Create `src/lib/components/flow-editor/nodes/RouterNode.svelte` (Task 5).
- Modify `src/lib/components/flow-editor/FlowCanvas.svelte` — nodeTypes + drop (Task 5, 6).
- Modify `src/lib/components/flow-editor/FlowSidebar.svelte` — palette (Task 6).

---

## RUNTIME TASKS (`langgraph-server/`, branch `dev`, run `npm test`; git paths prefixed `langgraph-server/` from meta-repo root)

### Task 1: Router types + classification-as-processing + pass-through runner

**Files:**
- Modify: `src/flow/types.ts`
- Modify: `src/flow/compile-flow.ts`

- [ ] **Step 1: Add types to `src/flow/types.ts`**

After `StructuredNodeData`:
```ts
export type RouterRuleOp = 'contains' | 'equals' | 'regex';

export type RouterBranch = {
  id: string;
  label: string;
  rule?: { op: RouterRuleOp; value: string };
};

export type RouterNodeData = {
  mode: 'rule' | 'llm';
  modelId?: string;
  branches: RouterBranch[];
  label: string;
};
```
Add `'router'` to the `FlowNode.type` union and `| RouterNodeData` to the `data` union.

- [ ] **Step 2: Register `'router'` as processing in `compile-flow.ts`**

Line 20 — add `'router'`:
```ts
const PROCESSING_TYPES = ['llm', 'agent', 'pluginAction', 'transform', 'structured', 'router'] as const;
```
In `compileFlow`'s `processing` filter (~line 133-136), add `|| n.type === 'router'`.
Add `RouterNodeData` to the type import from `./types.js`. Add `SystemMessage` to the `@langchain/core/messages` import (used in Task 2).

- [ ] **Step 3: Add the pass-through router runner in `buildNodeRunner`**

Before the final `throw` (after the `structured` branch):
```ts
  // router node — routing happens on the conditional edge; the node itself is a pass-through.
  if (node.type === 'router') {
    return async () => ({ messages: [] });
  }
```

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors. (A router currently compiles as a pass-through node; conditional-edge wiring comes in Task 3. No test added yet.)

- [ ] **Step 5: Commit**

```bash
git add langgraph-server/src/flow/types.ts langgraph-server/src/flow/compile-flow.ts
git commit -m "feat(flow): router node types + pass-through runner"
```

---

### Task 2: Routing functions (`matchesRule`, `classifyWithLlm`, `buildRouterRoute`)

**Files:**
- Modify: `src/flow/compile-flow.ts`
- Modify: `src/flow/compile-flow.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `src/flow/compile-flow.test.ts`:
```ts
import { matchesRule, buildRouterRoute } from './compile-flow.js';
import type { RouterNodeData } from './types.js';

describe('matchesRule', () => {
  it('contains', () => {
    expect(matchesRule('hello world', { op: 'contains', value: 'world' })).toBe(true);
    expect(matchesRule('hello', { op: 'contains', value: 'world' })).toBe(false);
  });
  it('equals', () => {
    expect(matchesRule('hi', { op: 'equals', value: 'hi' })).toBe(true);
    expect(matchesRule('hi ', { op: 'equals', value: 'hi' })).toBe(false);
  });
  it('regex (and invalid regex → false)', () => {
    expect(matchesRule('abc123', { op: 'regex', value: '\\d+' })).toBe(true);
    expect(matchesRule('abc', { op: 'regex', value: '[' })).toBe(false);
  });
});

function routerNode(data: Partial<RouterNodeData>): FlowNode {
  return { id: 'r1', type: 'router', position: { x: 0, y: 0 }, data: { mode: 'rule', branches: [], label: 'R', ...data } as never };
}
const stateWith = (text: string) => ({ messages: [new HumanMessage(text)] }) as never;

describe('buildRouterRoute — rule mode', () => {
  const node = routerNode({ mode: 'rule', branches: [
    { id: 'b1', label: 'urgent', rule: { op: 'contains', value: 'urgent' } },
    { id: 'b2', label: 'greet', rule: { op: 'contains', value: 'hello' } },
  ] });
  const connected = new Set(['b1', 'b2', 'default']);
  it('first match wins, ordered', async () => {
    const route = buildRouterRoute(node, connected, {});
    expect(await route(stateWith('this is urgent and hello'))).toBe('b1');
  });
  it('falls to default when none match', async () => {
    const route = buildRouterRoute(node, connected, {});
    expect(await route(stateWith('nothing here'))).toBe('default');
  });
  it('clamps a matched-but-unconnected branch to default', async () => {
    const route = buildRouterRoute(node, new Set(['b2', 'default']), {});
    expect(await route(stateWith('urgent'))).toBe('default'); // b1 matched but not connected
  });
});

describe('buildRouterRoute — llm mode', () => {
  const node = routerNode({ mode: 'llm', branches: [
    { id: 'b1', label: 'sales' }, { id: 'b2', label: 'support' },
  ] });
  const connected = new Set(['b1', 'b2', 'default']);
  it('maps the model label to the branch id', async () => {
    const fakeModel = { async invoke() { return new AIMessage('support'); } };
    const route = buildRouterRoute(node, connected, { model: fakeModel });
    expect(await route(stateWith('my app is broken'))).toBe('b2');
  });
  it('unknown label → default', async () => {
    const fakeModel = { async invoke() { return new AIMessage('zzz'); } };
    const route = buildRouterRoute(node, connected, { model: fakeModel });
    expect(await route(stateWith('x'))).toBe('default');
  });
});
```

- [ ] **Step 2: Run, verify fail**

Run: `npm test -- src/flow/compile-flow.test.ts` → FAIL (`matchesRule`/`buildRouterRoute` not exported).

- [ ] **Step 3: Implement in `compile-flow.ts`**

Add (near the other runner helpers, after `lastMessageContent`):
```ts
export function matchesRule(input: string, rule: { op: RouterRuleOp; value: string }): boolean {
  switch (rule.op) {
    case 'contains': return input.includes(rule.value);
    case 'equals': return input === rule.value;
    case 'regex': { try { return new RegExp(rule.value).test(input); } catch { return false; } }
  }
}

async function classifyWithLlm(input: string, data: RouterNodeData, opts: CompileOptions): Promise<string> {
  const model: ChatModel = opts.model ?? resolveProviderModel(data.modelId ?? DEFAULT_MODEL);
  const labels = [...data.branches.map((b) => b.label), 'default'];
  const sys =
    `Classify the input into exactly one of these labels: ${labels.join(', ')}. ` +
    `Reply with ONLY the label, nothing else.`;
  const res = await model.invoke([new SystemMessage(sys), new HumanMessage(input)]);
  const answer = String(res.content).trim().toLowerCase();
  const match = data.branches.find((b) => b.label.toLowerCase() === answer);
  return match ? match.id : 'default';
}

/** Build the conditional-edge routing fn for a router node. Exported for tests. */
export function buildRouterRoute(
  node: FlowNode,
  connectedHandles: Set<string>,
  opts: CompileOptions,
): (state: typeof MessagesAnnotation.State) => Promise<string> {
  const data = node.data as RouterNodeData;
  return async (state) => {
    const input = lastMessageContent(state);
    let chosen = 'default';
    if (data.mode === 'rule') {
      for (const b of data.branches) {
        if (b.rule && matchesRule(input, b.rule)) { chosen = b.id; break; }
      }
    } else {
      chosen = await classifyWithLlm(input, data, opts);
    }
    return connectedHandles.has(chosen) ? chosen : 'default';
  };
}
```
Add `RouterRuleOp` to the type import from `./types.js` (alongside `RouterNodeData` added in Task 1). `RouterNodeData` already imported. `SystemMessage` import added in Task 1 Step 2 — confirm it's present.

- [ ] **Step 4: Run, verify pass**

Run: `npm test -- src/flow/compile-flow.test.ts` → PASS (new router-route tests + all prior).

- [ ] **Step 5: Commit**

```bash
git add langgraph-server/src/flow/compile-flow.ts langgraph-server/src/flow/compile-flow.test.ts
git commit -m "feat(flow): router routing functions (rule eval + llm classify)"
```

---

### Task 3: Conditional-edge compile (wire routers in `compileFlow`)

**Files:**
- Modify: `src/flow/compile-flow.ts`
- Modify: `src/flow/compile-flow.test.ts`

- [ ] **Step 1: Write the failing integration tests**

Append to `src/flow/compile-flow.test.ts`:
```ts
describe('compileFlow — router integration', () => {
  // Two distinguishable downstream llm nodes so we can prove which branch fired.
  const mkLlm = (id: string): FlowNode => ({ id, type: 'llm', position: { x: 0, y: 0 }, data: { modelId: 'm', label: id } });

  it('rule router fires the matching branch only', async () => {
    const invoked: string[] = [];
    // The fake model records each input it sees, so we can assert which branch's node ran.
    const fakeModel = { async invoke(msgs: BaseMessage[]) { invoked.push(String(msgs[msgs.length - 1].content)); return new AIMessage('out'); } };
    const router: FlowNode = { id: 'r1', type: 'router', position: { x: 0, y: 0 }, data: { mode: 'rule', label: 'R', branches: [ { id: 'b1', label: 'A', rule: { op: 'contains', value: 'go-a' } } ] } as never };
    const a = mkLlm('na'); const b = mkLlm('nb');
    const eIn: FlowEdge = { id: 'e0', source: 'p1', sourceHandle: 'o', target: 'r1', targetHandle: 'i', type: 'flow' };
    const eA: FlowEdge = { id: 'ea', source: 'r1', sourceHandle: 'b1', target: 'na', targetHandle: 'i', type: 'flow' };
    const eB: FlowEdge = { id: 'eb', source: 'r1', sourceHandle: 'default', target: 'nb', targetHandle: 'i', type: 'flow' };
    const promptGoA: FlowNode = { id: 'p1', type: 'promptBox', position: { x: 0, y: 0 }, data: { label: 'P', value: 'please go-a now' } };
    const { graph, initialState } = compileFlow([promptGoA, router, a, b], [eIn, eA, eB], { model: fakeModel });
    await graph.invoke(initialState);
    // Branch A matched ('go-a' in input) → only node 'na' ran (saw the prompt). 'nb' did not.
    expect(invoked).toEqual(['please go-a now']);
  });

  it('routes to default → END when nothing matches and default is unconnected', async () => {
    const fakeModel = { async invoke() { return new AIMessage('x'); } };
    const router: FlowNode = { id: 'r1', type: 'router', position: { x: 0, y: 0 }, data: { mode: 'rule', label: 'R', branches: [ { id: 'b1', label: 'A', rule: { op: 'contains', value: 'zzz' } } ] } as never };
    const a = mkLlm('na');
    const eIn: FlowEdge = { id: 'e0', source: 'p1', sourceHandle: 'o', target: 'r1', targetHandle: 'i', type: 'flow' };
    const eA: FlowEdge = { id: 'ea', source: 'r1', sourceHandle: 'b1', target: 'na', targetHandle: 'i', type: 'flow' };
    // prompt value 'Hello' does NOT contain 'zzz' → default → END (default handle unconnected)
    const { graph, initialState } = compileFlow([prompt, router, a], [eIn, eA], { model: fakeModel });
    const result = await graph.invoke(initialState);
    // 'na' never ran; final message is still the prompt.
    expect(String(result.messages[result.messages.length - 1].content)).toBe('Hello');
  });
});
```

- [ ] **Step 2: Run, verify fail**

Run: `npm test -- src/flow/compile-flow.test.ts` → FAIL (router edges currently `addEdge` to all targets → both branches run / type error on `addConditionalEdges`).

- [ ] **Step 3: Extend the `AnyGraph` type + restructure the edge phase in `compileFlow`**

Add `addConditionalEdges` to the `AnyGraph` type (~line 140-144):
```ts
  type AnyGraph = {
    addNode: (name: string, fn: (s: typeof MessagesAnnotation.State) => Promise<{ messages: BaseMessage[] }>) => void;
    addEdge: (from: string, to: string) => void;
    addConditionalEdges: (
      source: string,
      path: (s: typeof MessagesAnnotation.State) => Promise<string>,
      pathMap: Record<string, string>,
    ) => void;
    compile: () => ReturnType<typeof builder.compile>;
  };
```

Replace the edge-building block (current lines 150-157 — the `hasOutgoing` set, the `for (const e of flowEdges)` loop, and the sink loop) with a grouped, per-source dispatch:
```ts
  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const outgoing = new Map<string, FlowEdge[]>();
  for (const e of flowEdges) {
    if (!outgoing.has(e.source)) outgoing.set(e.source, []);
    outgoing.get(e.source)!.push(e);
  }

  // Entry node's out-edges start the graph.
  for (const e of outgoing.get(entryNode.id) ?? []) g.addEdge(START, e.target);

  for (const node of processing) {
    const outs = outgoing.get(node.id) ?? [];
    if (node.type === 'router') {
      const pathMap: Record<string, string> = {};
      for (const e of outs) pathMap[e.sourceHandle || 'default'] = e.target;
      if (!pathMap.default) pathMap.default = END;
      const connected = new Set(Object.keys(pathMap));
      g.addConditionalEdges(node.id, buildRouterRoute(node, connected, opts), pathMap);
    } else if (outs.length === 0) {
      g.addEdge(node.id, END);
    } else {
      for (const e of outs) g.addEdge(node.id, e.target);
    }
  }
```
(`nodeById` is used only if you prefer a lookup; the per-`processing`-node loop already has the node object, so `nodeById` may be unused — if so, omit it to avoid a lint error. Routers are excluded from the `→ END` sink rule because their `pathMap.default` covers termination.)

- [ ] **Step 4: Run, verify pass + full suite + typecheck**

Run: `npm test -- src/flow/compile-flow.test.ts` then `npm test && npx tsc --noEmit` → all green.

- [ ] **Step 5: Commit**

```bash
git add langgraph-server/src/flow/compile-flow.ts langgraph-server/src/flow/compile-flow.test.ts
git commit -m "feat(flow): compile router nodes via addConditionalEdges"
```

---

## HUB TASKS (`minion_hub/`, branch `dev`, run `bun run check`)

### Task 4: Hub router types

**Files:**
- Modify: `src/lib/state/features/flow-editor.svelte.ts`

- [ ] **Step 1: Add the types (mirror runtime)**

After `StructuredNodeData`:
```ts
export type RouterRuleOp = 'contains' | 'equals' | 'regex';

export type RouterBranch = {
  id: string;
  label: string;
  rule?: { op: RouterRuleOp; value: string };
};

export type RouterNodeData = {
  mode: 'rule' | 'llm';
  modelId?: string;
  branches: RouterBranch[];
  label: string;
};
```
Extend `FlowNode.type` with `| 'router'` and the `data` union with `| RouterNodeData`.

- [ ] **Step 2: Type-check**

Run: `bun run check` → no NEW errors referencing flow-editor.svelte.ts.

- [ ] **Step 3: Commit**

```bash
git add src/lib/state/features/flow-editor.svelte.ts
git commit -m "feat(flow-editor): add router node data types"
```

---

### Task 5: `RouterNode.svelte` component

**Files:**
- Create: `src/lib/components/flow-editor/nodes/RouterNode.svelte`
- Modify: `src/lib/components/flow-editor/FlowCanvas.svelte` (imports + nodeTypes)

Context: a router node with a mode toggle, branch-list editor, per-branch output handles + a `default` output handle, and (llm mode) a model select. Mirror the `models.list` fetch from `StructuredNode.svelte`/`LLMNode.svelte` and the `setNodes`-map update pattern. Multiple source handles with distinct ids are supported by `@xyflow/svelte`; after adding/removing branches, the node's handle geometry changes — import `useUpdateNodeInternals` from `@xyflow/svelte` and call it for `id` after a branch change so edges re-anchor. Validate with the Svelte MCP autofixer.

- [ ] **Step 1: Create `src/lib/components/flow-editor/nodes/RouterNode.svelte`**

```svelte
<script lang="ts">
  import { Handle, Position, useUpdateNodeInternals } from '@xyflow/svelte';
  import type { NodeProps } from '@xyflow/svelte';
  import type { RouterNodeData, RouterBranch, RouterRuleOp } from '$lib/state/features/flow-editor.svelte';
  import { flowEditorState, setNodes } from '$lib/state/features/flow-editor.svelte';
  import { sendRequest } from '$lib/services/gateway.svelte';
  import { Split, Plus, X } from 'lucide-svelte';
  import { onMount, tick } from 'svelte';

  let { data, id }: NodeProps & { data: RouterNodeData } = $props();

  const updateNodeInternals = useUpdateNodeInternals();

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

  function makeBranchId() {
    return `b-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  }

  function patch(partial: Partial<RouterNodeData>) {
    const next = flowEditorState.nodes.map((n) =>
      n.id === id ? { ...n, data: { ...n.data, ...partial } } : n,
    );
    setNodes(next);
  }

  async function setBranches(branches: RouterBranch[]) {
    patch({ branches });
    await tick();
    updateNodeInternals(id);
  }

  function addBranch() {
    setBranches([...data.branches, { id: makeBranchId(), label: `Branch ${data.branches.length + 1}`, rule: { op: 'contains', value: '' } }]);
  }
  function removeBranch(branchId: string) {
    setBranches(data.branches.filter((b) => b.id !== branchId));
  }
  function updateBranch(branchId: string, partial: Partial<RouterBranch>) {
    patch({ branches: data.branches.map((b) => (b.id === branchId ? { ...b, ...partial } : b)) });
  }
  function updateRule(branchId: string, partial: Partial<{ op: RouterRuleOp; value: string }>) {
    const b = data.branches.find((x) => x.id === branchId);
    const rule = { op: b?.rule?.op ?? 'contains', value: b?.rule?.value ?? '', ...partial };
    updateBranch(branchId, { rule });
  }

  const OPS: RouterRuleOp[] = ['contains', 'equals', 'regex'];
</script>

<Handle type="target" position={Position.Left} id="in" class="!w-3 !h-3 !border-2 !border-amber-400 !bg-amber-900" />

<div class="relative bg-bg2 border rounded-xl px-4 py-3 min-w-56 max-w-72 shadow-lg select-none border-border hover:border-border/80">
  <div class="flex items-center gap-2 mb-2">
    <div class="w-6 h-6 rounded-md bg-amber-500/20 flex items-center justify-center shrink-0">
      <Split size={12} class="text-amber-400" />
    </div>
    <span class="text-xs font-semibold text-foreground truncate">{data.label || 'Router'}</span>
  </div>

  <div class="flex gap-1 mb-2">
    <button
      class="flex-1 text-[9px] font-semibold rounded px-1 py-0.5 transition-colors {data.mode === 'rule' ? 'bg-amber-500/25 text-amber-300 border border-amber-500/40' : 'text-muted/60 border border-transparent'}"
      onclick={(e) => { e.stopPropagation(); patch({ mode: 'rule' }); }}
    >Rule</button>
    <button
      class="flex-1 text-[9px] font-semibold rounded px-1 py-0.5 transition-colors {data.mode === 'llm' ? 'bg-amber-500/25 text-amber-300 border border-amber-500/40' : 'text-muted/60 border border-transparent'}"
      onclick={(e) => { e.stopPropagation(); patch({ mode: 'llm' }); }}
    >LLM</button>
  </div>

  {#if data.mode === 'llm'}
    <select
      class="w-full text-[10px] bg-bg3 border border-border rounded px-1 py-0.5 text-foreground mb-2"
      value={data.modelId ?? ''}
      onclick={(e) => e.stopPropagation()}
      onchange={(e) => patch({ modelId: (e.target as HTMLSelectElement).value })}
    >
      {#each models as mdl (mdl.id)}
        <option value={mdl.id}>{mdl.name ?? mdl.id}</option>
      {/each}
    </select>
  {/if}

  <div class="flex flex-col gap-1.5">
    {#each data.branches as branch, i (branch.id)}
      <div class="relative flex items-center gap-1">
        <input
          class="flex-1 text-[10px] bg-bg3 border border-border rounded px-1 py-0.5 text-foreground"
          value={branch.label}
          placeholder="label"
          onclick={(e) => e.stopPropagation()}
          oninput={(e) => updateBranch(branch.id, { label: (e.target as HTMLInputElement).value })}
        />
        {#if data.mode === 'rule'}
          <select
            class="text-[9px] bg-bg3 border border-border rounded px-0.5 py-0.5 text-foreground"
            value={branch.rule?.op ?? 'contains'}
            onclick={(e) => e.stopPropagation()}
            onchange={(e) => updateRule(branch.id, { op: (e.target as HTMLSelectElement).value as RouterRuleOp })}
          >
            {#each OPS as op (op)}<option value={op}>{op}</option>{/each}
          </select>
          <input
            class="w-14 text-[10px] bg-bg3 border border-border rounded px-1 py-0.5 text-foreground"
            value={branch.rule?.value ?? ''}
            placeholder="value"
            onclick={(e) => e.stopPropagation()}
            oninput={(e) => updateRule(branch.id, { value: (e.target as HTMLInputElement).value })}
          />
        {/if}
        <button class="text-muted/60 hover:text-red-400" onclick={(e) => { e.stopPropagation(); removeBranch(branch.id); }} title="Remove branch">
          <X size={11} />
        </button>
        <Handle type="source" position={Position.Right} id={branch.id} style="top: {30 + i * 24}px" class="!w-3 !h-3 !border-2 !border-amber-400 !bg-amber-900" />
      </div>
    {/each}
  </div>

  <button class="mt-1.5 flex items-center gap-1 text-[10px] text-amber-400/80 hover:text-amber-300" onclick={(e) => { e.stopPropagation(); addBranch(); }}>
    <Plus size={11} /> Add branch
  </button>

  <div class="relative mt-2 pt-1.5 border-t border-border/50 text-[10px] text-muted">
    default
    <Handle type="source" position={Position.Right} id="default" class="!w-3 !h-3 !border-2 !border-slate-400 !bg-slate-900" />
  </div>
</div>
```
(The `style="top: ..."` per-branch handle offset is a pragmatic vertical spread; adjust the constants if the autofixer or visual check flags overlap. The `default` handle sits at the node's natural bottom-right. `useUpdateNodeInternals` re-measures handles after branch add/remove.)

- [ ] **Step 2: Register in `FlowCanvas.svelte`**

Import + add to `nodeTypes`:
```ts
  import RouterNode from './nodes/RouterNode.svelte';
```
```ts
    router: RouterNode,
```

- [ ] **Step 3: Validate with the Svelte autofixer**

Run the Svelte MCP autofixer on `RouterNode.svelte`; fix; re-run clean. (Confirm `useUpdateNodeInternals` is the correct `@xyflow/svelte` export name in the installed version; if it differs, use the documented equivalent — the autofixer/docs lookup will surface it.)

- [ ] **Step 4: Type-check**

Run: `bun run check` → no NEW errors referencing RouterNode.svelte / FlowCanvas.svelte.

- [ ] **Step 5: Commit**

```bash
git add src/lib/components/flow-editor/nodes/RouterNode.svelte src/lib/components/flow-editor/FlowCanvas.svelte
git commit -m "feat(flow-editor): Router node component (mode toggle + branch editor)"
```

---

### Task 6: Palette item + drop handler

**Files:**
- Modify: `src/lib/components/flow-editor/FlowSidebar.svelte`
- Modify: `src/lib/components/flow-editor/FlowCanvas.svelte`

- [ ] **Step 1: FlowSidebar — `addRouter` + palette items**

Add `type RouterNodeData` to the import from `$lib/state/features/flow-editor.svelte`; add `Split` to the lucide-svelte import. Add a `makeId` is already present. Add:
```ts
  function addRouter() {
    const node: FlowNode = {
      id: makeId(), type: 'router', position: getDropPosition(),
      data: { mode: 'rule', branches: [{ id: `b-${makeId()}`, label: 'Branch 1', rule: { op: 'contains', value: '' } }], label: 'Router' } satisfies RouterNodeData,
    };
    setNodes([...flowEditorState.nodes, node]);
  }
```
Widen `handleDragStart`'s non-plugin payload union to include `'router'`.

EXPANDED view (Inputs section, after the Structured button) add:
```svelte
        <button
          onclick={addRouter}
          draggable="true"
          ondragstart={(e) => handleDragStart(e, { type: 'router' })}
          class="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-left hover:bg-bg3 transition-colors border border-transparent hover:border-border/60"
        >
          <div class="w-6 h-6 rounded bg-amber-500/20 flex items-center justify-center shrink-0">
            <Split size={12} class="text-amber-400" />
          </div>
          <div>
            <div class="text-xs font-medium text-foreground">Router</div>
            <div class="text-[10px] text-muted">Branch by rule / LLM</div>
          </div>
        </button>
```
COLLAPSED view: add a `Split` icon button after the Structured icon (`onclick={addRouter}`, `ondragstart={(e) => handleDragStart(e, { type: 'router' })}`, title "Router").

- [ ] **Step 2: FlowCanvas — drop branch**

Add `type RouterNodeData` to the import. Widen the `handleDrop` payload `type` union with `'router'`. After the `structured` branch:
```ts
    } else if (payload.type === 'router') {
      const node: FlowNode = {
        id: makeId(), type: 'router', position,
        data: { mode: 'rule', branches: [{ id: `b-${makeId()}`, label: 'Branch 1', rule: { op: 'contains', value: '' } }], label: 'Router' } satisfies RouterNodeData,
      };
      setNodes([...flowEditorState.nodes, node]);
    }
```

- [ ] **Step 3: Validate with the Svelte autofixer**

Run the autofixer on both files; fix; re-run clean.

- [ ] **Step 4: Type-check**

Run: `bun run check` → no NEW errors referencing these files.

- [ ] **Step 5: Manual verification**

With the hub dev server RESTARTED (dev-server HMR gotcha) and the langgraph server running: drag a Router after a Prompt, add 2 branches with `contains` rules + a downstream node per branch + a default node; Run with inputs hitting different branches; confirm the right path fires. Switch to LLM mode + a model; confirm classification routing. If you can't run the servers, say so.

- [ ] **Step 6: Commit**

```bash
git add src/lib/components/flow-editor/FlowSidebar.svelte src/lib/components/flow-editor/FlowCanvas.svelte
git commit -m "feat(flow-editor): Router palette item + drop handling"
```

---

## Final Verification (after all tasks)

- [ ] Runtime: `npm test && npx tsc --noEmit` (router route + integration tests + all prior green).
- [ ] Hub: `bun run check` (no new errors; RouterNode autofixer-clean).
- [ ] Manual E2E: rule routing fires the matching branch; default→END when nothing matches; LLM-mode classification routes; existing flows + B1 chains still run; a cycle through a router is rejected.
- [ ] Dispatch a final cross-repo code review.

---

## Notes for the Executor

- **Do not bump any package version** — Changesets owns versioning.
- **Commit scope**: stage only the files named per task; never `git add -A`.
- **Branches**: runtime `dev` (meta-repo), hub `dev`. Don't switch/merge.
- **Run git from the correct repo root** — `cd` into the repo first if a commit errors with "beyond a symbolic link".
- **Push is blocked** (SSH identity) — commits stay local.
- **Svelte**: use the autofixer; Svelte 5 runes only. Confirm `useUpdateNodeInternals` export name against the installed `@xyflow/svelte`.
- **`addConditionalEdges` typing**: extends the existing B1 `as unknown as AnyGraph` cast — no `any`; resolve `path`/`pathMap` types against `@langchain/langgraph@1.3.1`.
- Router is a pass-through runner; routing lives entirely on the conditional edge. Don't make the router append messages.
