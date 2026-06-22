# Flow-editor Copilot — Implementation Plan (Phase 4)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development or superpowers:executing-plans. Steps use `- [ ]`.

**Goal:** Conversationally edit a DB flow via a hub-side copilot side panel that proposes changes shown as a visual canvas diff the user confirms/rejects.

**Architecture:** Pure flow-ops + flow-diff modules; a hub `/api/flows/[id]/copilot` endpoint running OpenRouter (AI SDK) with flow-editing tool-calls on a working copy; a `FlowCopilotPanel` docked in `/flow-editor/[id]`; `FlowCanvas` gains a diff-overlay prop.

**Tech Stack:** SvelteKit 2, Svelte 5 runes, AI SDK `generateText`+`tool` (ai ^6), zod ^4, OpenRouter, Drizzle (pg), Vitest.

## Global Constraints
- `bun run check` 0/0/0; `bun run test` green. Svelte 5 only. No new dependency (ai/zod present).
- i18n via `m.*`, keys in en.json + es.json, then `bun run i18n:compile`.
- `OPENROUTER_API_KEY` (same env as artifact-builder). Model env `ARTIFACT_BUILDER_MODEL` reused or a new `FLOW_COPILOT_MODEL` default `anthropic/claude-3.7-sonnet`.
- Work on `dev`; commit per task `git -c commit.gpgsign=false`.

**Shared types (from `src/lib/state/features/flow-editor.svelte.ts`):**
`FlowNode { id; type; position:{x,y}; data }`, `FlowEdge { id; source; sourceHandle; target; targetHandle; type:'flow'|'context'; label? }`. flow-ops treats `data` structurally as `Record<string, unknown>` (carries a `label`).

---

### Task 1: `flow-ops.ts` pure reducers + tests

**Files:** Create `src/lib/flows/flow-ops.ts`; Test `src/lib/flows/flow-ops.test.ts`.

**Interfaces — Produces:**
`WorkingFlow = { nodes: FlowNode[]; edges: FlowEdge[] }`
`addNode(f, {type, label, data?, position?, id?}) → { flow, nodeId }`
`connectNodes(f, {source, target, sourceHandle?, targetHandle?}) → WorkingFlow`
`updateNodeConfig(f, {nodeId, data}) → WorkingFlow`
`setNodeLabel(f, {nodeId, label}) → WorkingFlow`
`removeNode(f, {nodeId}) → WorkingFlow`
`removeEdge(f, {edgeId}) → WorkingFlow`
`validateFlow(f) → { ok: boolean; issues: string[] }`

- [ ] **Step 1: Write failing tests**

```ts
import { describe, it, expect } from 'vitest';
import { addNode, connectNodes, updateNodeConfig, setNodeLabel, removeNode, removeEdge, validateFlow } from './flow-ops';

const empty = { nodes: [], edges: [] };

describe('flow-ops', () => {
  it('addNode appends a node with given id + label', () => {
    const { flow, nodeId } = addNode(empty, { type: 'llm', label: 'Draft', id: 'llm-1' });
    expect(nodeId).toBe('llm-1');
    expect(flow.nodes).toHaveLength(1);
    expect(flow.nodes[0]).toMatchObject({ id: 'llm-1', type: 'llm', data: { label: 'Draft' } });
  });

  it('connectNodes adds an edge; rejects unknown node', () => {
    let f = addNode(empty, { type: 'trigger', label: 'T', id: 't1' }).flow;
    f = addNode(f, { type: 'llm', label: 'L', id: 'l1' }).flow;
    f = connectNodes(f, { source: 't1', target: 'l1' });
    expect(f.edges).toHaveLength(1);
    expect(f.edges[0]).toMatchObject({ source: 't1', target: 'l1', type: 'flow' });
    expect(() => connectNodes(f, { source: 't1', target: 'nope' })).toThrow();
  });

  it('connectNodes dedups identical edges', () => {
    let f = addNode(addNode(empty, { type: 'trigger', label: 'T', id: 't1' }).flow, { type: 'llm', label: 'L', id: 'l1' }).flow;
    f = connectNodes(f, { source: 't1', target: 'l1' });
    f = connectNodes(f, { source: 't1', target: 'l1' });
    expect(f.edges).toHaveLength(1);
  });

  it('updateNodeConfig shallow-merges data; setNodeLabel sets label', () => {
    let f = addNode(empty, { type: 'llm', label: 'L', id: 'l1', data: { modelId: 'x' } }).flow;
    f = updateNodeConfig(f, { nodeId: 'l1', data: { modelId: 'y' } });
    expect(f.nodes[0].data).toMatchObject({ modelId: 'y', label: 'L' });
    f = setNodeLabel(f, { nodeId: 'l1', label: 'New' });
    expect((f.nodes[0].data as { label: string }).label).toBe('New');
  });

  it('removeNode drops the node + incident edges', () => {
    let f = addNode(addNode(empty, { type: 'trigger', label: 'T', id: 't1' }).flow, { type: 'llm', label: 'L', id: 'l1' }).flow;
    f = connectNodes(f, { source: 't1', target: 'l1' });
    f = removeNode(f, { nodeId: 'l1' });
    expect(f.nodes).toHaveLength(1);
    expect(f.edges).toHaveLength(0);
  });

  it('removeEdge drops by id', () => {
    let f = addNode(addNode(empty, { type: 'trigger', label: 'T', id: 't1' }).flow, { type: 'llm', label: 'L', id: 'l1' }).flow;
    f = connectNodes(f, { source: 't1', target: 'l1' });
    const edgeId = f.edges[0].id;
    f = removeEdge(f, { edgeId });
    expect(f.edges).toHaveLength(0);
  });

  it('validateFlow flags missing trigger + dangling edge', () => {
    const noTrigger = addNode(empty, { type: 'llm', label: 'L', id: 'l1' }).flow;
    expect(validateFlow(noTrigger).issues.some((i) => /trigger/i.test(i))).toBe(true);
    const dangling = { nodes: [{ id: 't1', type: 'trigger', position: { x: 0, y: 0 }, data: { label: 'T' } }], edges: [{ id: 'e1', source: 't1', sourceHandle: 'out', target: 'ghost', targetHandle: 'in', type: 'flow' }] } as never;
    expect(validateFlow(dangling).issues.some((i) => /ghost|missing/i.test(i))).toBe(true);
  });
});
```

- [ ] **Step 2: Run — verify fail** · `bun run vitest run src/lib/flows/flow-ops.test.ts` → FAIL (module missing).

- [ ] **Step 3: Implement**

```ts
import type { FlowNode, FlowEdge } from '$lib/state/features/flow-editor.svelte';

export type WorkingFlow = { nodes: FlowNode[]; edges: FlowEdge[] };

const clone = (f: WorkingFlow): WorkingFlow => ({ nodes: [...f.nodes], edges: [...f.edges] });
const has = (f: WorkingFlow, id: string) => f.nodes.some((n) => n.id === id);

export function addNode(
  f: WorkingFlow,
  args: { type: string; label: string; data?: Record<string, unknown>; position?: { x: number; y: number }; id?: string },
): { flow: WorkingFlow; nodeId: string } {
  const id = args.id ?? `${args.type}-${crypto.randomUUID().slice(0, 8)}`;
  if (has(f, id)) throw new Error(`node id already exists: ${id}`);
  const node = {
    id,
    type: args.type,
    position: args.position ?? { x: 0, y: 0 },
    data: { label: args.label, ...(args.data ?? {}) },
  } as unknown as FlowNode;
  const flow = clone(f);
  flow.nodes = [...flow.nodes, node];
  return { flow, nodeId: id };
}

export function connectNodes(
  f: WorkingFlow,
  args: { source: string; target: string; sourceHandle?: string; targetHandle?: string },
): WorkingFlow {
  if (!has(f, args.source)) throw new Error(`unknown source: ${args.source}`);
  if (!has(f, args.target)) throw new Error(`unknown target: ${args.target}`);
  const sourceHandle = args.sourceHandle ?? 'out';
  const targetHandle = args.targetHandle ?? 'in';
  const dup = f.edges.some(
    (e) => e.source === args.source && e.target === args.target && e.sourceHandle === sourceHandle && e.targetHandle === targetHandle,
  );
  if (dup) return f;
  const edge = {
    id: `e-${crypto.randomUUID().slice(0, 8)}`,
    source: args.source,
    sourceHandle,
    target: args.target,
    targetHandle,
    type: 'flow' as const,
  } as FlowEdge;
  const flow = clone(f);
  flow.edges = [...flow.edges, edge];
  return flow;
}

function mapNode(f: WorkingFlow, nodeId: string, fn: (n: FlowNode) => FlowNode): WorkingFlow {
  if (!has(f, nodeId)) throw new Error(`unknown node: ${nodeId}`);
  const flow = clone(f);
  flow.nodes = flow.nodes.map((n) => (n.id === nodeId ? fn(n) : n));
  return flow;
}

export function updateNodeConfig(f: WorkingFlow, args: { nodeId: string; data: Record<string, unknown> }): WorkingFlow {
  return mapNode(f, args.nodeId, (n) => ({ ...n, data: { ...(n.data as object), ...args.data } }) as FlowNode);
}

export function setNodeLabel(f: WorkingFlow, args: { nodeId: string; label: string }): WorkingFlow {
  return mapNode(f, args.nodeId, (n) => ({ ...n, data: { ...(n.data as object), label: args.label } }) as FlowNode);
}

export function removeNode(f: WorkingFlow, args: { nodeId: string }): WorkingFlow {
  if (!has(f, args.nodeId)) throw new Error(`unknown node: ${args.nodeId}`);
  const flow = clone(f);
  flow.nodes = flow.nodes.filter((n) => n.id !== args.nodeId);
  flow.edges = flow.edges.filter((e) => e.source !== args.nodeId && e.target !== args.nodeId);
  return flow;
}

export function removeEdge(f: WorkingFlow, args: { edgeId: string }): WorkingFlow {
  const flow = clone(f);
  flow.edges = flow.edges.filter((e) => e.id !== args.edgeId);
  return flow;
}

const TRIGGER_TYPES = new Set(['trigger', 'schedule', 'pluginTrigger']);

export function validateFlow(f: WorkingFlow): { ok: boolean; issues: string[] } {
  const issues: string[] = [];
  if (!f.nodes.some((n) => TRIGGER_TYPES.has(n.type))) issues.push('Flow has no trigger/schedule node.');
  const ids = new Set(f.nodes.map((n) => n.id));
  if (ids.size !== f.nodes.length) issues.push('Duplicate node ids.');
  for (const e of f.edges) {
    if (!ids.has(e.source)) issues.push(`Edge ${e.id} references missing source ${e.source}.`);
    if (!ids.has(e.target)) issues.push(`Edge ${e.id} references missing (ghost) target ${e.target}.`);
  }
  return { ok: issues.length === 0, issues };
}
```

- [ ] **Step 4: Run — verify pass** · `bun run vitest run src/lib/flows/flow-ops.test.ts` → PASS.
- [ ] **Step 5: Commit** · `git add src/lib/flows/flow-ops.ts src/lib/flows/flow-ops.test.ts && git -c commit.gpgsign=false commit -m "feat(flows): pure flow-ops reducers + validateFlow + tests"`

---

### Task 2: `flow-diff.ts` pure + tests

**Files:** Create `src/lib/flows/flow-diff.ts`; Test `src/lib/flows/flow-diff.test.ts`.

**Interfaces — Produces:**
`FlowDiff = { nodes: Record<string, 'added'|'removed'|'changed'>; edges: Record<string, 'added'|'removed'> }`
`diffFlow(current: WorkingFlow, proposed: WorkingFlow) → FlowDiff`

- [ ] **Step 1: Failing test**

```ts
import { describe, it, expect } from 'vitest';
import { diffFlow } from './flow-diff';

const n = (id: string, data: object = { label: id }) => ({ id, type: 'llm', position: { x: 0, y: 0 }, data });
const e = (id: string, s: string, t: string) => ({ id, source: s, sourceHandle: 'out', target: t, targetHandle: 'in', type: 'flow' });

describe('diffFlow', () => {
  it('classifies added / removed / changed', () => {
    const cur = { nodes: [n('a'), n('b')], edges: [e('e1', 'a', 'b')] } as never;
    const prop = { nodes: [n('a', { label: 'A2' }), n('c')], edges: [e('e2', 'a', 'c')] } as never;
    const d = diffFlow(cur, prop);
    expect(d.nodes).toEqual({ a: 'changed', b: 'removed', c: 'added' });
    expect(d.edges).toEqual({ e1: 'removed', e2: 'added' });
  });

  it('empty diff when identical', () => {
    const cur = { nodes: [n('a')], edges: [] } as never;
    expect(diffFlow(cur, cur)).toEqual({ nodes: {}, edges: {} });
  });
});
```

- [ ] **Step 2: Run — fail.**
- [ ] **Step 3: Implement**

```ts
import type { WorkingFlow } from './flow-ops';

export type FlowDiff = {
  nodes: Record<string, 'added' | 'removed' | 'changed'>;
  edges: Record<string, 'added' | 'removed'>;
};

const sig = (data: unknown, type: string) => `${type}:${JSON.stringify(data)}`;

export function diffFlow(current: WorkingFlow, proposed: WorkingFlow): FlowDiff {
  const diff: FlowDiff = { nodes: {}, edges: {} };
  const cur = new Map(current.nodes.map((n) => [n.id, n]));
  const prop = new Map(proposed.nodes.map((n) => [n.id, n]));
  for (const [id, p] of prop) {
    const c = cur.get(id);
    if (!c) diff.nodes[id] = 'added';
    else if (sig(c.data, c.type) !== sig(p.data, p.type)) diff.nodes[id] = 'changed';
  }
  for (const id of cur.keys()) if (!prop.has(id)) diff.nodes[id] = 'removed';

  const curE = new Map(current.edges.map((e) => [e.id, e]));
  const propE = new Map(proposed.edges.map((e) => [e.id, e]));
  for (const id of propE.keys()) if (!curE.has(id)) diff.edges[id] = 'added';
  for (const id of curE.keys()) if (!propE.has(id)) diff.edges[id] = 'removed';
  return diff;
}
```

- [ ] **Step 4: Run — pass.**
- [ ] **Step 5: Commit** · `feat(flows): diffFlow (added/removed/changed) + tests`

---

### Task 3: Copilot endpoint `/api/flows/[id]/copilot` + gating test

**Files:** Create `src/routes/api/flows/[id]/copilot/+server.ts`; Test `src/routes/api/flows/[id]/copilot/copilot.gating.test.ts`.

**Interfaces — Produces:** `POST` body `{ messages: {role,content}[] }` → `{ message: string; proposedFlow: WorkingFlow; validation: {ok,issues} }` (502 on LLM error, 403 non-admin-non-owner, 404 missing).

- [ ] **Step 1: Write the gating test** (mock the model + db)

```ts
import { describe, it, expect, vi } from 'vitest';

vi.mock('ai', () => ({
  generateText: vi.fn(async () => ({ text: 'done', steps: [] })),
  tool: (def: unknown) => def,
}));
vi.mock('@ai-sdk/openai', () => ({ createOpenAI: () => () => ({}) }));
vi.mock('$env/dynamic/private', () => ({ env: { OPENROUTER_API_KEY: 'k' } }));

const flowRow = { id: 'f1', userId: 'owner1', tenantId: 'org1', nodes: '[]', edges: '[]' };
vi.mock('$server/db/with-org-core', () => ({ withOrgCore: (_s: unknown, fn: (t: unknown) => unknown) => fn({ select: () => ({ from: () => ({ where: () => Promise.resolve([flowRow]) }) }) }) }));
vi.mock('$server/db/pg-client', () => ({ getCoreDb: () => ({}) }));
vi.mock('$server/auth/core-ctx', () => ({ requireCoreCtx: async () => ({ tenantId: 'org1', profileId: 'p1' }) }));

import { POST } from './+server';

function req(body: object) {
  return { request: { json: async () => body }, params: { id: 'f1' } } as never;
}

describe('copilot endpoint gating', () => {
  it('403 for non-admin non-owner', async () => {
    const locals = { user: { id: 'other', role: 'member' } } as never;
    await expect(POST({ ...req({ messages: [] }), locals })).rejects.toMatchObject({ status: 403 });
  });
  it('allows the flow owner', async () => {
    const locals = { user: { id: 'owner1', role: 'member' } } as never;
    const res = await POST({ ...req({ messages: [{ role: 'user', content: 'hi' }] }), locals });
    expect(res.status).toBeLessThan(400);
  });
  it('allows an admin', async () => {
    const locals = { user: { id: 'x', role: 'admin' } } as never;
    const res = await POST({ ...req({ messages: [{ role: 'user', content: 'hi' }] }), locals });
    expect(res.status).toBeLessThan(400);
  });
});
```

- [ ] **Step 2: Run — fail.**
- [ ] **Step 3: Implement**

```ts
import type { RequestHandler } from './$types';
import { json, error } from '@sveltejs/kit';
import { generateText, tool } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { z } from 'zod';
import { env } from '$env/dynamic/private';
import { and, eq } from 'drizzle-orm';
import { requireCoreCtx } from '$server/auth/core-ctx';
import { getCoreDb } from '$server/db/pg-client';
import { withOrgCore } from '$server/db/with-org-core';
import { flows } from '$server/db/pg-schema/flows';
import * as ops from '$lib/flows/flow-ops';
import type { WorkingFlow } from '$lib/flows/flow-ops';

const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';

const SYSTEM = `You edit an automation flow (nodes + edges). Node types: trigger, schedule, agent, llm, router, toolAgent, channel, handoff, reaction, transform, structured, pluginTrigger, pluginAction. Make the SMALLEST change that satisfies the user. Use the provided tools to mutate the flow; reference nodes by id. After editing, call validate. Explain what you changed in one short paragraph.`;

export const POST: RequestHandler = async ({ locals, params, request }) => {
  const ctx = await requireCoreCtx(locals);
  const body = (await request.json().catch(() => null)) as { messages?: { role: 'user' | 'assistant'; content: string }[] } | null;
  const messages = body?.messages ?? [];

  const [row] = await withOrgCore({ db: getCoreDb(), tenantId: ctx.tenantId }, (tx) =>
    tx.select().from(flows).where(and(eq(flows.id, params.id), eq(flows.tenantId, ctx.tenantId))),
  );
  if (!row) throw error(404, 'flow not found');
  const isAdmin = locals.user?.role === 'admin';
  const isOwner = !!locals.user?.id && row.userId === locals.user.id;
  if (!isAdmin && !isOwner) throw error(403, 'admins or the flow owner only');

  const apiKey = env.OPENROUTER_API_KEY;
  if (!apiKey) throw error(503, 'copilot unavailable: OPENROUTER_API_KEY not set');

  let work: WorkingFlow = { nodes: JSON.parse(row.nodes), edges: JSON.parse(row.edges) };
  const openrouter = createOpenAI({ apiKey, baseURL: OPENROUTER_BASE_URL });

  const tools = {
    addNode: tool({
      description: 'Add a node. Returns the new node id.',
      parameters: z.object({ type: z.string(), label: z.string(), data: z.record(z.unknown()).optional() }),
      execute: async (a) => { const r = ops.addNode(work, a); work = r.flow; return { nodeId: r.nodeId }; },
    }),
    connectNodes: tool({
      description: 'Connect source → target.',
      parameters: z.object({ source: z.string(), target: z.string(), sourceHandle: z.string().optional(), targetHandle: z.string().optional() }),
      execute: async (a) => { work = ops.connectNodes(work, a); return { ok: true }; },
    }),
    updateNodeConfig: tool({
      description: 'Shallow-merge data into a node.',
      parameters: z.object({ nodeId: z.string(), data: z.record(z.unknown()) }),
      execute: async (a) => { work = ops.updateNodeConfig(work, a); return { ok: true }; },
    }),
    setNodeLabel: tool({
      description: 'Rename a node.',
      parameters: z.object({ nodeId: z.string(), label: z.string() }),
      execute: async (a) => { work = ops.setNodeLabel(work, a); return { ok: true }; },
    }),
    removeNode: tool({
      description: 'Remove a node and its edges.',
      parameters: z.object({ nodeId: z.string() }),
      execute: async (a) => { work = ops.removeNode(work, a); return { ok: true }; },
    }),
    removeEdge: tool({
      description: 'Remove an edge by id.',
      parameters: z.object({ edgeId: z.string() }),
      execute: async (a) => { work = ops.removeEdge(work, a); return { ok: true }; },
    }),
    validate: tool({
      description: 'Validate the current flow.',
      parameters: z.object({}),
      execute: async () => ops.validateFlow(work),
    }),
  };

  const model = env.FLOW_COPILOT_MODEL || env.ARTIFACT_BUILDER_MODEL || 'anthropic/claude-3.7-sonnet';
  let text: string;
  try {
    const res = await generateText({
      model: openrouter(model),
      system: `${SYSTEM}\n\nCurrent flow:\n${JSON.stringify(work)}`,
      messages,
      tools,
      maxSteps: 8,
    });
    text = res.text;
  } catch (e) {
    throw error(502, `copilot failed: ${(e as Error).message}`);
  }

  return json({ message: text, proposedFlow: work, validation: ops.validateFlow(work) });
};
```

- [ ] **Step 4: Run — pass** · `bun run vitest run src/routes/api/flows/[id]/copilot/copilot.gating.test.ts`.
- [ ] **Step 5: Commit** · `feat(flows): copilot endpoint (AI-SDK flow-editing tools, admin/owner gated) + gating tests`

---

### Task 4: diff overlay via `flowEditorState.previewDiff`

`FlowCanvas` renders from the global `flowEditorState` store (NOT props), so the diff rides the store.

**Files:** Modify `src/lib/state/features/flow-editor.svelte.ts` (add field); Modify `src/lib/components/flow-editor/FlowCanvas.svelte`.

**Interfaces — Consumes:** `FlowDiff` (Task 2). **Produces:** `flowEditorState.previewDiff: FlowDiff | null` (default null).

- [ ] **Step 1: Add `previewDiff` to the store**

In `flow-editor.svelte.ts`, in the `export const flowEditorState = $state({ … })` object, add `previewDiff: null as import('$lib/flows/flow-diff').FlowDiff | null,`.

- [ ] **Step 2: Ring styling in FlowCanvas**

In `FlowCanvas.svelte` `<script>` add:
```ts
function diffRing(id: string): string {
  const s = flowEditorState.previewDiff?.nodes[id];
  return s === 'added'
    ? 'ring-2 ring-emerald-400'
    : s === 'changed'
      ? 'ring-2 ring-amber-400'
      : s === 'removed'
        ? 'ring-2 ring-red-400 opacity-60'
        : '';
}
```
At the node-data mapping (~line 106, where `flowEditorState.nodes.map((n) => …)` builds the SvelteFlow nodes), merge `diffRing(n.id)` into each node's `class`/`className` field (SvelteFlow node supports a `class`). When `previewDiff` is null the function returns `''` → no change to today's rendering. (Edge tinting optional v1 — node rings carry the signal; skip edge styling unless trivial.)

- [ ] **Step 3: Verify** · `bun run check` → 0/0/0.
- [ ] **Step 4: Commit** · `feat(flow-editor): previewDiff on editor store + FlowCanvas diff rings`

---

### Task 5: i18n keys

**Files:** Modify `messages/en.json`, `messages/es.json`.

- [ ] **Step 1: Add keys** (en, with es equivalents):
```
"flow_copilot_title": "Flow copilot",
"flow_copilot_placeholder": "Describe the change you want…",
"flow_copilot_send": "Send",
"flow_copilot_thinking": "Thinking…",
"flow_copilot_confirm": "Apply changes",
"flow_copilot_reject": "Discard",
"flow_copilot_proposed": "Proposed changes — review on the canvas.",
"flow_copilot_invalid": "Heads up: the proposal has validation warnings."
```
es: "Copiloto de flujo" / "Describe el cambio que quieres…" / "Enviar" / "Pensando…" / "Aplicar cambios" / "Descartar" / "Cambios propuestos — revísalos en el lienzo." / "Aviso: la propuesta tiene advertencias de validación."

- [ ] **Step 2:** `bun run i18n:compile && bun run check` → 0/0/0.
- [ ] **Step 3: Commit** · `i18n(flows): flow copilot strings (en/es)`

---

### Task 6: `FlowCopilotPanel` + wire into `/flow-editor/[id]`

**Files:** Create `src/lib/components/flow-editor/FlowCopilotPanel.svelte`; Modify `src/routes/(app)/flow-editor/[id]/+page.svelte`; create/modify `src/routes/(app)/flow-editor/[id]/+page.ts` (or `.server.ts`) for `canCopilot`.

**Interfaces — Consumes:** endpoint (T3), `diffFlow` (T2), `flowEditorState`/`setNodes`/`setEdges` (existing).

- [ ] **Step 1: `canCopilot` from the load**

If `/flow-editor/[id]` has a `+page.ts`, fetch the flow's `userId` (the GET `/api/flows/[id]` already returns it) and compute `canCopilot = page.data.permissions?.isAdmin || flow.userId === currentUserId`. Expose `canCopilot` + `flowOwnerId`. (Use the existing auth-derived `page.data` for admin + current user; see CLAUDE.md canonical-load-flow — do NOT add client `/api/me` fetches.)

- [ ] **Step 2: Create `FlowCopilotPanel.svelte`**

```svelte
<script lang="ts">
  import * as m from '$lib/paraglide/messages';
  import { Sparkles, Send, Check, X } from 'lucide-svelte';
  import ChatMessage from '$lib/components/chat/ChatMessage.svelte';
  import Spinner from '$lib/components/ui/Spinner.svelte';
  import type { WorkingFlow } from '$lib/flows/flow-ops';

  let {
    flowId,
    current,
    onpreview,
    onapply,
    onreject,
  }: {
    flowId: string;
    current: WorkingFlow;
    onpreview: (proposed: WorkingFlow | null) => void;
    onapply: (proposed: WorkingFlow) => void;
    onreject: () => void;
  } = $props();

  type Turn = { role: 'user' | 'assistant'; content: string };
  let messages = $state<Turn[]>([]);
  let input = $state('');
  let busy = $state(false);
  let proposal = $state<WorkingFlow | null>(null);
  let validation = $state<{ ok: boolean; issues: string[] } | null>(null);
  let errorMsg = $state('');

  async function send() {
    const text = input.trim();
    if (!text || busy) return;
    messages = [...messages, { role: 'user', content: text }];
    input = '';
    busy = true;
    errorMsg = '';
    try {
      const res = await fetch(`/api/flows/${flowId}/copilot`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages }),
      });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        errorMsg = (b as { message?: string }).message ?? `Error ${res.status}`;
        return;
      }
      const data = (await res.json()) as { message: string; proposedFlow: WorkingFlow; validation: { ok: boolean; issues: string[] } };
      messages = [...messages, { role: 'assistant', content: data.message }];
      proposal = data.proposedFlow;
      validation = data.validation;
      onpreview(data.proposedFlow);
    } catch (e) {
      errorMsg = e instanceof Error ? e.message : 'Unknown error';
    } finally {
      busy = false;
    }
  }

  function apply() {
    if (proposal) onapply(proposal);
    proposal = null; validation = null; onpreview(null);
  }
  function reject() {
    proposal = null; validation = null; onpreview(null); onreject();
  }
</script>

<aside class="flex h-full w-80 shrink-0 flex-col border-l border-white/10 bg-white/[0.02]">
  <header class="flex items-center gap-2 border-b border-white/10 px-4 py-3 text-sm font-semibold text-white">
    <Sparkles size={15} /> {m.flow_copilot_title()}
  </header>

  <div class="flex-1 space-y-3 overflow-y-auto p-3">
    {#each messages as msg (msg)}
      <ChatMessage message={msg} />
    {/each}
    {#if busy}<div class="flex items-center gap-2 text-xs text-white/50"><Spinner size="xs" /> {m.flow_copilot_thinking()}</div>{/if}
    {#if errorMsg}<p class="text-xs text-red-400">{errorMsg}</p>{/if}
  </div>

  {#if proposal}
    <div class="border-t border-white/10 p-3">
      <p class="mb-2 text-xs text-white/70">{m.flow_copilot_proposed()}</p>
      {#if validation && !validation.ok}
        <p class="mb-2 text-[11px] text-amber-300">{m.flow_copilot_invalid()}</p>
      {/if}
      <div class="flex gap-2">
        <button type="button" onclick={apply} class="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-emerald-500/15 px-3 py-1.5 text-xs font-medium text-emerald-300 ring-1 ring-emerald-500/30 hover:bg-emerald-500/25">
          <Check size={13} /> {m.flow_copilot_confirm()}
        </button>
        <button type="button" onclick={reject} class="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-white/5 px-3 py-1.5 text-xs font-medium text-white/70 ring-1 ring-white/10 hover:bg-white/10">
          <X size={13} /> {m.flow_copilot_reject()}
        </button>
      </div>
    </div>
  {/if}

  <div class="border-t border-white/10 p-3">
    <div class="flex items-end gap-2">
      <textarea
        bind:value={input}
        rows={2}
        placeholder={m.flow_copilot_placeholder()}
        onkeydown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
        class="flex-1 resize-none rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-white placeholder-white/30 outline-none focus:border-white/30"
      ></textarea>
      <button type="button" onclick={send} disabled={busy || !input.trim()} class="grid size-9 shrink-0 place-items-center rounded-lg bg-white/10 text-white hover:bg-white/20 disabled:opacity-40">
        <Send size={15} />
      </button>
    </div>
  </div>
</aside>
```

- [ ] **Step 3: Wire into the page**

In `/flow-editor/[id]/+page.svelte`. Preview works by writing the MERGED flow into the editor store (so the existing `FlowCanvas` shows it) + setting `flowEditorState.previewDiff`; a backup restores on reject.
```ts
import FlowCopilotPanel from '$lib/components/flow-editor/FlowCopilotPanel.svelte';
import { diffFlow } from '$lib/flows/flow-diff';
import { flowEditorState, setNodes, setEdges } from '$lib/state/features/flow-editor.svelte';
import type { WorkingFlow } from '$lib/flows/flow-ops';

let backup: WorkingFlow | null = null;
const current = $derived({ nodes: flowEditorState.nodes, edges: flowEditorState.edges } as WorkingFlow);

function onPreview(proposed: WorkingFlow | null) {
  if (!proposed) { // clear preview, restore real flow
    if (backup) { setNodes(backup.nodes); setEdges(backup.edges); backup = null; }
    flowEditorState.previewDiff = null;
    return;
  }
  if (!backup) backup = { nodes: [...flowEditorState.nodes], edges: [...flowEditorState.edges] };
  flowEditorState.previewDiff = diffFlow(backup, proposed);
  // merge backup ∪ proposed so removed items still render (as red-ringed ghosts)
  const nById = new Map(backup.nodes.map((n) => [n.id, n]));
  for (const n of proposed.nodes) nById.set(n.id, n);
  const eById = new Map(backup.edges.map((e) => [e.id, e]));
  for (const e of proposed.edges) eById.set(e.id, e);
  setNodes([...nById.values()]);
  setEdges([...eById.values()]);
}

async function onApply(proposed: WorkingFlow) {
  setNodes(proposed.nodes); setEdges(proposed.edges); // drop ghosts → exactly the proposal
  flowEditorState.previewDiff = null; backup = null;
  await fetch(`/api/flows/${flowEditorState.flowId}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nodes: proposed.nodes, edges: proposed.edges }),
  });
}

function onReject() { onPreview(null); }
```
Wrap the canvas + panel in a `flex` row; render the panel last:
```svelte
{#if data.canCopilot}
  <FlowCopilotPanel flowId={flowEditorState.flowId!} {current} onpreview={onPreview} onapply={onApply} onreject={onReject} />
{/if}
```
`FlowCanvas` needs no prop change — it already reads `flowEditorState` (nodes/edges + `previewDiff` from Task 4).

- [ ] **Step 4: Verify** · `bun run i18n:compile && bun run check` → 0/0/0; `bun run test` green.
- [ ] **Step 5: Commit** · `feat(flow-editor): copilot side panel + canvas diff preview/confirm/reject`

---

## Final verification
- [ ] `bun run check` 0/0/0; `bun run test` green (flow-ops, flow-diff, copilot gating).
- [ ] Manual (`:5173`, admin): open a DB flow at `/flow-editor/[id]` → copilot panel present → "add an LLM node after the trigger and connect them" → assistant replies, canvas shows a green node + edge (diff) + Apply/Discard bar → Apply persists (reload shows it); Discard reverts. Non-admin non-owner: panel hidden + endpoint 403.

## Self-review notes
- Spec coverage: §1 ops→T1, §2 diff→T2, §3 endpoint→T3, §4 overlay→T4, §5 panel→T6, §6 wiring→T6, i18n→T5. ✓
- Type consistency: `WorkingFlow`/`FlowDiff` defined T1/T2, consumed T3/T4/T6 by the same names. `addNode` signature matches across plan + spec. ✓
- No placeholders; all code shown. Pure logic + gating are unit-tested; UI is check-verified + manual.
- ✓ Resolved: `FlowCanvas` reads `flowEditorState` directly (not props), so the diff rides the store (`flowEditorState.previewDiff`, Task 4) and preview merges into the store via `setNodes/setEdges` with a backup for Reject (Task 6). No FlowCanvas prop change needed.
