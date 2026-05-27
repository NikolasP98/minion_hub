# Flow Editor — Router / Conditional Node (Sub-feature B2)

**Date:** 2026-05-27
**Status:** Approved — pending spec review
**Repos:** `langgraph-server` (conditional-edge compile + router runner) · `minion_hub` (RouterNode component + palette)
**Series:** Sub-feature **B**, phase **B2** of 3. B1 (graph foundation + Transform/Structured) is DONE; B3 (tool-calling LLM) follows. This phase depends on B1's DAG compile.

---

## Problem

B1 generalized `compileFlow` to a DAG but every edge is unconditional — flows can fan out but cannot *branch* (take one path based on the input). B2 adds a **Router** node that routes the flow to one of N labeled branches (or a default), either by deterministic rules or by LLM classification.

---

## Goal

A `router` node with:
- A **mode** toggle: `rule` (deterministic) or `llm` (classify).
- **N user-defined branches**, each an output handle, plus an always-present **`default`** output.
- **rule mode:** each branch has a rule (`contains` / `equals` / `regex`) tested against the input; **first match wins, ordered**; none match → `default`.
- **llm mode:** the model classifies the input into exactly one of the branch labels (or `default`); the returned label maps back to its branch.

The router does not transform the message — it only selects the downstream path. Compiles via LangGraph `addConditionalEdges`.

**Locked decisions:** mode = rule-OR-llm per node; branches = N + default; rule eval = first-match-wins ordered; llm = classify into branch labels + `default` (fixed prompt, label→id).

---

## Data Model

Mirrored in `langgraph-server/src/flow/types.ts` and `minion_hub/.../flow-editor.svelte.ts`:

```ts
export type RouterRuleOp = 'contains' | 'equals' | 'regex';

export type RouterBranch = {
  id: string;                            // == the output handle id (stable, unique within the node)
  label: string;
  rule?: { op: RouterRuleOp; value: string };  // present/used in rule mode
};

export type RouterNodeData = {
  mode: 'rule' | 'llm';
  modelId?: string;        // llm mode
  branches: RouterBranch[];
  label: string;
};
```
- `FlowNode.type` union gains `'router'`.
- The `default` branch is **implicit** — handle id `'default'`, always rendered, never stored in `branches`.

---

## Architecture

```
prompt ─▶ router ──(branch b1: rule/llm)──▶ node A
                └─(branch b2)──────────────▶ node B
                └─(default)────────────────▶ node C   (or END if unconnected)

compileFlow edge phase (per source node):
  • entry node      → addEdge(START, target)         (entry is never a router)
  • router node     → addConditionalEdges(routerId, routeFn, pathMap)
  • other node      → addEdge(source, target)         (B1 behavior)

router runner = pass-through (returns { messages: [] } — no append)
pathMap       = { <branch.id | 'default'> : targetNodeId }, from outgoing flow edges
                grouped by sourceHandle; 'default' always present (→ END if unconnected)
routeFn(state) = choose a branch id from the router's data, clamped to a connected handle
```

---

## Runtime Changes (`langgraph-server`, branch `dev`)

### 1. Types
Add `RouterRuleOp`, `RouterBranch`, `RouterNodeData` (above); add `'router'` to `FlowNode.type` and `RouterNodeData` to the `data` union.

### 2. `validateFlowShape`
Add `'router'` to `PROCESSING_TYPES` (so a router node is reachable-checked, included in the cycle DFS, and gets a graph node). No other validation change — the DAG/reachability/cycle rules already cover conditional edges (they are `flow` edges in the adjacency).

### 3. Router runner in `buildNodeRunner` (pass-through)
```ts
if (node.type === 'router') {
  return async () => ({ messages: [] });   // routing happens on the conditional edge
}
```
(Add before the final unknown-type throw.)

### 4. The routing function + conditional-edge wiring

A new exported (for tests) factory builds the route function for a router node, closed over the set of *connected* handle ids and the chooser:

```ts
export function buildRouterRoute(
  node: FlowNode,
  connectedHandles: Set<string>,   // handle ids that have an outgoing flow edge (+ always 'default')
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
      chosen = await classifyWithLlm(input, data, opts);   // returns a branch id or 'default'
    }
    return connectedHandles.has(chosen) ? chosen : 'default';
  };
}

function matchesRule(input: string, rule: { op: RouterRuleOp; value: string }): boolean {
  switch (rule.op) {
    case 'contains': return input.includes(rule.value);
    case 'equals':   return input === rule.value;
    case 'regex':    { try { return new RegExp(rule.value).test(input); } catch { return false; } }
  }
}

async function classifyWithLlm(input: string, data: RouterNodeData, opts: CompileOptions): Promise<string> {
  const model: ChatModel = opts.model ?? resolveProviderModel(data.modelId ?? DEFAULT_MODEL);
  const labels = [...data.branches.map((b) => b.label), 'default'];
  const sys = `Classify the input into exactly one of these labels: ${labels.join(', ')}. ` +
    `Reply with ONLY the label, nothing else.`;
  const res = await model.invoke([new SystemMessage(sys), new HumanMessage(input)]);
  const answer = String(res.content).trim().toLowerCase();
  const match = data.branches.find((b) => b.label.toLowerCase() === answer);
  return match ? match.id : 'default';
}
```
(`SystemMessage` imported from `@langchain/core/messages`. An invalid regex is treated as non-matching, not an error.)

### 5. `compileFlow` edge phase — per-source-node dispatch

Restructure the edge-building loop to group outgoing `flow` edges by source, then per source node:
- if `source === entryNode.id` → `addEdge(START, target)` for each (entry is promptBox/trigger — never a router);
- else if the source node is a **router** → build `pathMap` from its outgoing edges (`{ sourceHandle → target }`), ensure a `'default'` key exists (→ `END` if not connected), compute `connectedHandles = new Set(Object.keys(pathMap))`, and call `addConditionalEdges(source, buildRouterRoute(node, connectedHandles, opts), pathMap)`;
- else → `addEdge(source, target)` for each (B1 behavior).

Sink detection (`node → END` when no outgoing edge) **excludes router nodes** (a router's paths are fully defined by `pathMap`, including `default → END`). If a router has zero outgoing edges, `pathMap = { default: END }` and `routeFn` clamps every choice to `'default'`.

`addConditionalEdges` signature (LangGraph 1.3.1): `addConditionalEdges(source, path, pathMap)` where `path` may be async and return a key present in `pathMap`. Use the same `as unknown as AnyGraph` builder cast from B1, extended with an `addConditionalEdges` method on the `AnyGraph` type.

---

## Hub Changes (`minion_hub`, branch `dev`)

### 1. Types
Mirror the runtime types in `flow-editor.svelte.ts`; extend `FlowNode.type` + `data` union.

### 2. `RouterNode.svelte`
- Input handle (left). Mode toggle (Rule / LLM) — pill buttons like the AgentNode session toggle.
- **LLM mode:** a model `<select>` (reuse `sendRequest('models.list', {})` + fallback).
- **Branch list editor:** each branch row shows a label `<input>`, and in **rule mode** an op `<select>` (`contains`/`equals`/`regex`) + a value `<input>`; a remove (×) button; an "+ Add branch" button appends `{ id: makeId(), label: 'Branch N', rule: { op: 'contains', value: '' } }`.
- **Output handles (right):** one `<Handle type="source" id={branch.id}>` per branch (vertically distributed), plus a fixed `<Handle type="source" id="default">` labeled "default". (Handles re-render as branches are added/removed — `@xyflow` supports multiple source handles with distinct ids; call `updateNodeInternals` if needed via the svelte-flow store, else a key on the handle container forces re-measure.)
- All edits write via the `setNodes` map + `patch` pattern. Amber/orange accent + a `Split` (or `GitBranch`) lucide icon.

### 3. Register + palette + drop
- Register `router: RouterNode` in `FlowCanvas.svelte` `nodeTypes`.
- `FlowSidebar`: a "Router" palette item (both views) with `addRouter()` default data:
  ```ts
  { mode: 'rule', branches: [{ id: makeId(), label: 'Branch 1', rule: { op: 'contains', value: '' } }], label: 'Router' }
  ```
- `FlowCanvas` `handleDrop`: a `router` branch with the same default; widen the payload `type` union.

(The canvas `handleConnect` infers `flow` edges from non-context handles; router output handles are source handles, so edges from them carry the branch's `sourceHandle` — exactly what `compileFlow` reads to build `pathMap`. No edge-model change.)

---

## Error Handling

| Scenario | Behavior |
|---|---|
| No branch rule matches (rule mode) | Routes to `default` (→ its target, or `END` if unconnected). |
| `default` has no outgoing edge | `pathMap.default = END`; the flow ends cleanly. |
| A branch handle has no outgoing edge | Not in `pathMap`; `routeFn` clamps that choice to `default`. |
| Invalid regex in a rule | Treated as non-matching (no throw); evaluation continues to the next branch. |
| LLM returns an unrecognized label | No branch matches → `default`. |
| Router with zero branches + zero edges | `pathMap = { default: END }`; routes to END. (Degenerate but valid.) |
| Cycle through a router | Rejected by B1's cycle detection (conditional edges are in the adjacency). |

---

## Testing

**langgraph-server (`npm test`):**
- `matchesRule`: `contains`/`equals`/`regex` true & false cases; invalid regex → false.
- `buildRouterRoute` (rule mode): first-match-wins ordering; no match → `default`; chosen-but-unconnected branch clamped to `default`.
- `buildRouterRoute` (llm mode): injected fake model returning a label → maps to that branch id; unknown label → `default`.
- `compileFlow` integration: `prompt → router → {A, B}` with a rule that selects A runs A's node and not B (use fake llm/agent runners that record invocation); `default → END` when nothing matches and default is unconnected.
- Regression: B1 chains + existing tests still pass; cycle through a router rejected.
- Full `npm test` + `npx tsc --noEmit` green.

**Hub (`bun run check`):**
- `RouterNode.svelte` autofixer-clean; adding/removing a branch updates `data.branches` and renders the matching output handles; drop produces the default shape. (No DnD unit harness — `bun run check` + manual.)

**Manual E2E:** build `prompt → router(rule: contains "urgent" → A; default → B)`, run with inputs that do/don't contain "urgent", confirm the correct branch fires; switch the router to LLM mode + a model, confirm classification routing.

---

## Out of Scope (B3 / later)

- **Tool-calling LLM node (B3).**
- **All-matching fan-out routing** (B2 is single-path first-match-wins, explicitly).
- **Per-branch LLM description prompts** (B2 classifies by label only).
- **Loops** (still rejected — DAG only; a router cannot route backward).
- **Merge/join node** for re-converging branches (MessagesAnnotation concat handles incidental fan-in; no explicit join).
- Visual per-branch edge labels in the canvas beyond the handle ids.

---

## Config Summary

No new env vars. Reuses `resolveProviderModel` (llm mode), the existing run endpoints, and `PUBLIC_LANGGRAPH_FLOWS_URL`.
