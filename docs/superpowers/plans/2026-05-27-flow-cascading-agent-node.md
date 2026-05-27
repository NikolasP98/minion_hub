# Cascading "Agent" Node (Sub-feature A) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the flow-editor's per-agent palette sections with one "Agent" node whose cascading type→instance dropdowns select a custom agent (gateway + built), an org-scoped personal agent (by username), or a drone task (picker only; execution deferred).

**Architecture:** Pure hub-UI change plus two small read-only data sources: a new tenant-scoped hub endpoint `GET /api/personal-agents?scope=org` and a new `drones.list` gateway RPC. Execution reuses the existing `sendAgentTurn` path for custom/personal; drone-kind nodes throw a clear "coming soon" error in the langgraph runtime.

**Tech Stack:** TypeScript strict. Gateway `minion/` (pnpm, vitest, branch `DEV`). Runtime `langgraph-server/` (npm, vitest, branch `dev`, meta-repo). Hub `minion_hub/` (bun, vitest, SvelteKit 2 + Svelte 5 runes, `@xyflow/svelte`, branch `dev`).

**Spec:** `minion_hub/docs/superpowers/specs/2026-05-27-flow-cascading-agent-node-design.md`

**Refinement vs spec:** `agentKind` is an **optional** field (`agentKind?: 'custom'|'personal'|'drone'`) in both the langgraph and hub `AgentNodeData`. Custom/personal/unset all route to `sendAgentTurn` unchanged; only `agentKind === 'drone'` is special-cased (throws). This avoids churning existing agent fixtures and is type-safe for old saved nodes.

**Type sync:** `AgentNodeData.agentKind` must be added identically in `langgraph-server/src/flow/types.ts` (Task 2) and `minion_hub/.../flow-editor.svelte.ts` (Task 4).

---

## File Structure

**Gateway (`minion/`):**
- Create `src/drones/registry.ts` — `DroneMeta` type + `DRONES` array (Task 1).
- Create `src/gateway/server-methods/drones.ts` — `createDronesHandlers()` (Task 1).
- Create `src/gateway/server-methods/drones.test.ts` (Task 1).
- Modify `src/gateway/server.impl.ts` — spread handler (Task 1).

**Runtime (`langgraph-server/`):**
- Modify `src/flow/types.ts` — `agentKind?` on `AgentNodeData` (Task 2).
- Modify `src/flow/compile-flow.ts` — drone guard in agent branch (Task 2).
- Modify `src/flow/compile-flow.test.ts` (Task 2).

**Hub (`minion_hub/`):**
- Modify `src/server/services/personal-agent.service.ts` — `listOrgPersonalAgents` (Task 3).
- Create `src/server/services/personal-agent.service.test.ts` or append (Task 3).
- Create `src/routes/api/personal-agents/+server.ts` (Task 3).
- Create `src/routes/api/personal-agents/server.test.ts` (Task 3).
- Modify `src/lib/state/features/flow-editor.svelte.ts` — `agentKind?` (Task 4).
- Modify `src/lib/components/flow-editor/nodes/AgentNode.svelte` — cascading dropdowns (Task 5).
- Modify `src/lib/components/flow-editor/FlowSidebar.svelte` — remove agent sections, add single Agent item (Task 6).
- Modify `src/lib/components/flow-editor/FlowCanvas.svelte` — agent drop branch (Task 6).

---

## GATEWAY TASKS (`minion/`, branch `DEV`, run `pnpm test`)

### Task 1: `drones.list` RPC + drone registry

**Files:**
- Create: `src/drones/registry.ts`
- Create: `src/gateway/server-methods/drones.ts`
- Create: `src/gateway/server-methods/drones.test.ts`
- Modify: `src/gateway/server.impl.ts`

- [ ] **Step 1: Write the failing test**

Create `src/gateway/server-methods/drones.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { createDronesHandlers } from "./drones.js";

describe("drones.list", () => {
  it("responds with the drone registry", () => {
    const handlers = createDronesHandlers();
    let captured: unknown;
    handlers["drones.list"]({ respond: (_ok: boolean, payload?: unknown) => { captured = payload; } } as never);
    expect(captured).toHaveProperty("drones");
    const { drones } = captured as { drones: Array<{ id: string; description: string }> };
    expect(Array.isArray(drones)).toBe(true);
    expect(drones).toContainEqual(expect.objectContaining({ id: "summarize" }));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/gateway/server-methods/drones.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Create `src/drones/registry.ts`**

```ts
/** Metadata for a drone task, surfaced to the flow editor via the drones.list RPC. */
export type DroneMeta = { id: string; description: string };

/**
 * The drones available to the flow editor. Listing only (execution is a
 * follow-on). Currently the single production drone. The later drone-execution
 * sprint extends this registry with invocation wiring.
 */
export const DRONES: DroneMeta[] = [
  { id: "summarize", description: "Summarize a conversation transcript" },
];
```

- [ ] **Step 4: Create `src/gateway/server-methods/drones.ts`**

```ts
import { DRONES } from "../../drones/registry.js";
import type { GatewayRequestHandlers } from "./types.js";

/** Gateway RPC handlers for drones.* (listing only in sub-feature A). */
export function createDronesHandlers(): GatewayRequestHandlers {
  return {
    "drones.list": ({ respond }) => respond(true, { drones: DRONES }),
  };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run src/gateway/server-methods/drones.test.ts`
Expected: PASS.

- [ ] **Step 6: Wire into `src/gateway/server.impl.ts`**

Add the import after the existing `createFlowsNodesHandlers` import (near line 117):

```ts
import { createDronesHandlers } from "./server-methods/drones.js";
```

Add the spread in the `extraHandlers` object, right after `...createFlowsNodesHandlers(),`:

```ts
    ...createDronesHandlers(),
```

- [ ] **Step 7: Type-check**

Run: `pnpm tsgo`
Expected: no NEW errors from drones.ts / registry.ts / server.impl.ts.

- [ ] **Step 8: Commit**

```bash
git add src/drones/registry.ts src/gateway/server-methods/drones.ts src/gateway/server-methods/drones.test.ts src/gateway/server.impl.ts
git commit -m "feat(gateway): drones.list RPC + drone registry (listing only)"
```

---

## RUNTIME TASKS (`langgraph-server/`, branch `dev`, run `npm test`)

### Task 2: `agentKind` on AgentNodeData + drone guard in compileFlow

**Files:**
- Modify: `src/flow/types.ts` (AgentNodeData, ~lines 6-15)
- Modify: `src/flow/compile-flow.ts` (`buildExecNode` agent branch, ~lines 131-162)
- Modify: `src/flow/compile-flow.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `src/flow/compile-flow.test.ts`:

```ts
describe('compileFlow — agent node agentKind', () => {
  it('routes a custom-kind agent to gatewayClient.sendAgentTurn', async () => {
    const calls: string[] = [];
    const fakeGateway = {
      async sendAgentTurn(agentId: string) { calls.push(agentId); return 'gw-reply'; },
    };
    const customAgent: FlowNode = {
      id: 'a1', type: 'agent', position: { x: 200, y: 0 },
      data: { agentKind: 'custom', agentId: 'PANIK', label: 'PANIK', sessionMode: 'ephemeral' } as never,
    };
    const e: FlowEdge = { id: 'e', source: 'p1', sourceHandle: 'prompt-out', target: 'a1', targetHandle: 'in', type: 'flow' };
    const { graph, initialState } = compileFlow([prompt, customAgent], [e], { gatewayClient: fakeGateway });
    const result = await graph.invoke(initialState);
    expect(calls).toEqual(['PANIK']);
    expect(result.messages[result.messages.length - 1].content).toBe('gw-reply');
  });

  it('throws UnsupportedFlowError for a drone-kind agent', () => {
    const droneAgent: FlowNode = {
      id: 'a1', type: 'agent', position: { x: 200, y: 0 },
      data: { agentKind: 'drone', agentId: 'summarize', label: 'summarize', sessionMode: 'ephemeral' } as never,
    };
    const e: FlowEdge = { id: 'e', source: 'p1', sourceHandle: 'prompt-out', target: 'a1', targetHandle: 'in', type: 'flow' };
    expect(() => compileFlow([prompt, droneAgent], [e], { gatewayClient: { async sendAgentTurn() { return 'x'; } } }))
      .toThrow(UnsupportedFlowError);
  });
});
```

(`prompt`, `FlowNode`, `FlowEdge`, `compileFlow`, `UnsupportedFlowError` are already imported in the file.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- src/flow/compile-flow.test.ts`
Expected: FAIL (drone not guarded; agentKind not on type).

- [ ] **Step 3: Add `agentKind` to `AgentNodeData` in `src/flow/types.ts`**

In the `AgentNodeData` type (starts line 6), add as the first field:

```ts
export type AgentNodeData = {
  agentKind?: 'custom' | 'personal' | 'drone';
  agentId: string;
  label: string;
  sessionMode: 'ephemeral' | 'shared';
  defaultValues?: Record<string, string>;
  contextRules?: unknown[];
  inputHandles?: HandleDef[];
  outputHandles?: HandleDef[];
  contextHandles?: HandleDef[];
};
```

- [ ] **Step 4: Add the drone guard in `buildExecNode` (`src/flow/compile-flow.ts`)**

Find the agent branch (after the `llm` branch). It begins:
```ts
  // agent node — check for legacy claude-* id (backward compat)
  const agentData = node.data as AgentNodeData;
```
Insert the guard immediately after that `const agentData` line, before the `isLegacyLLM` check:

```ts
  if (agentData.agentKind === 'drone') {
    throw new UnsupportedFlowError('Drone execution is not yet supported — coming soon.');
  }
```

(Custom/personal/unset agentKind fall through to the existing `isLegacyLLM` check and the real-gateway `sendAgentTurn` dispatch — unchanged.)

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- src/flow/compile-flow.test.ts`
Expected: PASS (existing + 2 new).

- [ ] **Step 6: Full suite + typecheck**

Run: `npm test && npx tsc --noEmit`
Expected: all PASS, no type errors.

- [ ] **Step 7: Commit**

```bash
git add langgraph-server/src/flow/types.ts langgraph-server/src/flow/compile-flow.ts langgraph-server/src/flow/compile-flow.test.ts
git commit -m "feat(flow): agentKind on AgentNodeData; drone-kind throws coming-soon"
```
(If running git from inside `langgraph-server/`, use `src/flow/...` paths.)

---

## HUB TASKS (`minion_hub/`, branch `dev`, run `bun run test` / `bun run check`)

### Task 3: `listOrgPersonalAgents` service + `GET /api/personal-agents?scope=org`

**Files:**
- Modify: `src/server/services/personal-agent.service.ts`
- Create/append: `src/server/services/personal-agent.service.test.ts`
- Create: `src/routes/api/personal-agents/+server.ts`
- Create: `src/routes/api/personal-agents/server.test.ts`

Context: `listUsers(ctx)` (in `user.service.ts`) selects all users (tenant gate is the route's `tenantCtx`). Mirror that: inner-join `user` ⋈ `personalAgents` on `userId`. Both tables import from `@minion-stack/db/schema` (already imported in `personal-agent.service.ts`). `requireAuth(locals): AuthUser` is in `$server/auth/authorize`.

- [ ] **Step 1: Write the failing service test**

Create/append `src/server/services/personal-agent.service.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { listOrgPersonalAgents } from "./personal-agent.service";

describe("listOrgPersonalAgents", () => {
  it("returns {agentId, userName} for users joined with personal agents", async () => {
    const rows = [
      { agentId: "personal-u1", userName: "Alice" },
      { agentId: "personal-u2", userName: "bob@example.com" },
    ];
    // The service issues a single drizzle select().from().innerJoin().orderBy() chain.
    const orderBy = vi.fn().mockResolvedValue(rows);
    const innerJoin = vi.fn(() => ({ orderBy }));
    const from = vi.fn(() => ({ innerJoin }));
    const select = vi.fn(() => ({ from }));
    const ctx = { db: { select }, tenantId: "t1" } as never;

    const result = await listOrgPersonalAgents(ctx);
    expect(result).toEqual(rows);
    expect(select).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run it, verify fail**

Run: `bun run vitest run src/server/services/personal-agent.service.test.ts`
Expected: FAIL (`listOrgPersonalAgents` not exported).

- [ ] **Step 3: Implement `listOrgPersonalAgents` in `personal-agent.service.ts`**

Add (the `user` and `personalAgents` imports already exist at the top; add `sql`-free, use the imported `eq`):

```ts
/**
 * List personal agents of users in the tenant, labeled by username.
 * Tenant scoping matches listUsers(ctx) (route-level via tenantCtx). Inner-join
 * means only users WITH a personal agent are returned.
 */
export async function listOrgPersonalAgents(
  ctx: TenantContext,
): Promise<Array<{ agentId: string; userName: string }>> {
  return ctx.db
    .select({
      agentId: personalAgents.agentId,
      userName: sql<string>`coalesce(${user.name}, ${user.email})`,
    })
    .from(personalAgents)
    .innerJoin(user, eq(user.id, personalAgents.userId))
    .orderBy(user.createdAt);
}
```

NOTE: `sql` is already imported at the top of the file (`import { eq, and, inArray, lt, sql } from 'drizzle-orm';`). The test's mock returns whatever `orderBy` resolves to, so the exact column selection isn't asserted there — the shape `{agentId, userName}` is what matters.

- [ ] **Step 4: Run service test, verify pass**

Run: `bun run vitest run src/server/services/personal-agent.service.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing endpoint test**

Create `src/routes/api/personal-agents/server.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";

vi.mock("$server/services/personal-agent.service", () => ({
  listOrgPersonalAgents: vi.fn().mockResolvedValue([{ agentId: "personal-u1", userName: "Alice" }]),
}));
vi.mock("$server/auth/authorize", () => ({ requireAuth: vi.fn() }));

import { GET } from "./+server";

describe("GET /api/personal-agents", () => {
  it("401s without tenantCtx", async () => {
    await expect(
      (GET as never)({ locals: {} } as never),
    ).rejects.toMatchObject({ status: 401 });
  });

  it("returns the org personal-agent list", async () => {
    const res = await (GET as never)({ locals: { tenantCtx: { db: {}, tenantId: "t1" } } } as never);
    const body = await res.json();
    expect(body).toEqual({ personalAgents: [{ agentId: "personal-u1", userName: "Alice" }] });
  });
});
```

- [ ] **Step 6: Run it, verify fail**

Run: `bun run vitest run src/routes/api/personal-agents/server.test.ts`
Expected: FAIL (route module not found).

- [ ] **Step 7: Create `src/routes/api/personal-agents/+server.ts`**

```ts
import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { requireAuth } from '$server/auth/authorize';
import { listOrgPersonalAgents } from '$server/services/personal-agent.service';

export const GET: RequestHandler = async ({ locals }) => {
  requireAuth(locals);
  if (!locals.tenantCtx) throw error(401);
  const personalAgents = await listOrgPersonalAgents(locals.tenantCtx);
  return json({ personalAgents });
};
```

- [ ] **Step 8: Run endpoint test, verify pass**

Run: `bun run vitest run src/routes/api/personal-agents/server.test.ts`
Expected: PASS (2 tests).

NOTE: `/api/personal-agents` is NOT in `API_UNAUTH_FALLBACK_PATHS` in `hooks.server.ts`, so the global gate requires an authenticated session/tenantCtx before reaching the handler — which is the intended behavior (members only). No hooks change needed.

- [ ] **Step 9: Commit**

```bash
git add src/server/services/personal-agent.service.ts src/server/services/personal-agent.service.test.ts "src/routes/api/personal-agents/+server.ts" src/routes/api/personal-agents/server.test.ts
git commit -m "feat(api): GET /api/personal-agents?scope=org — org personal agents by username"
```

---

### Task 4: `agentKind` on hub `AgentNodeData`

**Files:**
- Modify: `src/lib/state/features/flow-editor.svelte.ts` (`AgentNodeData`, ~lines 12-21)

- [ ] **Step 1: Add `agentKind` to `AgentNodeData`**

Change the type (currently starts with `agentId`):

```ts
export type AgentNodeData = {
  agentKind?: 'custom' | 'personal' | 'drone';
  agentId: string;
  label: string;
  sessionMode: 'ephemeral' | 'shared';
  defaultValues: Record<string, string>;
  contextRules: ContextRule[];
  inputHandles: HandleDef[];
  outputHandles: HandleDef[];
  contextHandles: HandleDef[];
};
```

- [ ] **Step 2: Type-check**

Run: `bun run check`
Expected: no NEW errors referencing flow-editor.svelte.ts (≈18 pre-existing unrelated errors are fine).

- [ ] **Step 3: Commit**

```bash
git add src/lib/state/features/flow-editor.svelte.ts
git commit -m "feat(flow-editor): add optional agentKind to hub AgentNodeData"
```

---

### Task 5: `AgentNode.svelte` cascading dropdowns

**Files:**
- Modify: `src/lib/components/flow-editor/nodes/AgentNode.svelte`

Context: the current node has ONE agent `<select>` (gw.agents) + a session-mode toggle + the handle blocks. Replace the single select with a **type** select and an **instance** select. Keep the session-mode toggle, settings panel, and all Handle blocks exactly as they are. Built agents come from `builderState.agents` (`built:<id>` ids). Personal list comes from `/api/personal-agents?scope=org`; drone list from `sendRequest('drones.list', {})`. Validate the final component with the Svelte MCP autofixer.

- [ ] **Step 1: Rework the `<script>` block**

Replace the imports + `pickAgent` with type/instance handling. The new script (keep `showSettings`, `hovered`, `showHandles`, `isHandleConnected`, `setSessionMode` as they are):

```svelte
<script lang="ts">
  import { Handle, Position } from '@xyflow/svelte';
  import type { NodeProps } from '@xyflow/svelte';
  import type { AgentNodeData } from '$lib/state/features/flow-editor.svelte';
  import { flowEditorState, setNodes } from '$lib/state/features/flow-editor.svelte';
  import { gw } from '$lib/state/gateway/gateway-data.svelte';
  import { builderState } from '$lib/state/builder';
  import { agentDisplayName } from '$lib/utils/agent-display';
  import { sendRequest } from '$lib/services/gateway.svelte';
  import { Bot } from 'lucide-svelte';
  import { onMount } from 'svelte';
  import * as m from '$lib/paraglide/messages';

  let { data, id, selected }: NodeProps & { data: AgentNodeData } = $props();

  let showSettings = $state(false);
  let hovered = $state(false);
  const showHandles = $derived(flowEditorState.relationshipMode || selected || hovered);

  type Kind = 'custom' | 'personal' | 'drone';
  interface InstanceOption { id: string; label: string }

  let personalAgents = $state<InstanceOption[]>([]);
  let drones = $state<InstanceOption[]>([]);
  let loadedPersonal = $state(false);
  let loadedDrones = $state(false);

  // Custom instances are reactive over gateway + built agents.
  const customOptions = $derived<InstanceOption[]>([
    ...gw.agents.map((a) => ({ id: a.id, label: agentDisplayName(a) })),
    ...builderState.agents.map((a) => ({ id: `built:${a.id}`, label: a.name })),
  ]);

  const instanceOptions = $derived<InstanceOption[]>(
    data.agentKind === 'custom'
      ? customOptions
      : data.agentKind === 'personal'
        ? personalAgents
        : data.agentKind === 'drone'
          ? drones
          : [],
  );

  async function loadPersonal() {
    if (loadedPersonal) return;
    loadedPersonal = true;
    try {
      const res = await fetch('/api/personal-agents?scope=org');
      if (res.ok) {
        const body = (await res.json()) as { personalAgents?: Array<{ agentId: string; userName: string }> };
        personalAgents = (body.personalAgents ?? []).map((p) => ({ id: p.agentId, label: p.userName }));
      }
    } catch {
      personalAgents = [];
    }
  }

  async function loadDrones() {
    if (loadedDrones) return;
    loadedDrones = true;
    try {
      const res = (await sendRequest('drones.list', {})) as { drones?: Array<{ id: string; description: string }> } | null;
      drones = (res?.drones ?? []).map((d) => ({ id: d.id, label: d.description || d.id }));
    } catch {
      drones = [];
    }
  }

  onMount(() => {
    // Pre-load lists for whichever type is already selected on a saved node.
    if (data.agentKind === 'personal') loadPersonal();
    if (data.agentKind === 'drone') loadDrones();
  });

  function isHandleConnected(handleId: string): boolean {
    return flowEditorState.edges.some(
      (e) =>
        (e.source === id && e.sourceHandle === handleId) ||
        (e.target === id && e.targetHandle === handleId),
    );
  }

  function patch(partial: Partial<AgentNodeData>) {
    const next = flowEditorState.nodes.map((n) =>
      n.id === id ? { ...n, data: { ...n.data, ...partial } } : n,
    );
    setNodes(next);
  }

  function pickKind(e: Event) {
    const agentKind = (e.target as HTMLSelectElement).value as Kind;
    patch({ agentKind, agentId: '', label: agentKind === 'custom' ? 'Agent' : agentKind });
    if (agentKind === 'personal') loadPersonal();
    if (agentKind === 'drone') loadDrones();
  }

  function pickInstance(e: Event) {
    const agentId = (e.target as HTMLSelectElement).value;
    const label = instanceOptions.find((o) => o.id === agentId)?.label ?? agentId;
    patch({ agentId, label });
  }

  function setSessionMode(mode: 'ephemeral' | 'shared') {
    patch({ sessionMode: mode });
  }
</script>
```

- [ ] **Step 2: Replace the agent `<select>` in the template**

Replace the existing single "Agent picker" `<select>` block (the `<select ... onchange={pickAgent}>…</select>`) with the two cascading selects + the drone hint:

```svelte
  <!-- Type picker -->
  <select
    class="mt-1 w-full text-[10px] bg-bg3 border border-border rounded px-1 py-0.5 text-foreground"
    value={data.agentKind ?? ''}
    onclick={(e) => e.stopPropagation()}
    onchange={pickKind}
  >
    <option value="" disabled>Select type…</option>
    <option value="custom">Custom agent</option>
    <option value="personal">Personal agent</option>
    <option value="drone">Drone task</option>
  </select>

  <!-- Instance picker (disabled until a type is chosen) -->
  <select
    class="mt-1 w-full text-[10px] bg-bg3 border border-border rounded px-1 py-0.5 text-foreground disabled:opacity-50"
    value={data.agentId}
    disabled={!data.agentKind}
    onclick={(e) => e.stopPropagation()}
    onchange={pickInstance}
  >
    <option value="" disabled>
      {data.agentKind ? 'Select…' : 'Pick a type first'}
    </option>
    {#each instanceOptions as opt (opt.id)}
      <option value={opt.id}>{opt.label}</option>
    {/each}
    {#if data.agentId && !instanceOptions.some((o) => o.id === data.agentId)}
      <option value={data.agentId}>{data.label || data.agentId}</option>
    {/if}
  </select>

  {#if data.agentKind === 'drone' && data.agentId}
    <p class="mt-1 text-[9px] text-amber-400/80">Drone execution coming soon</p>
  {/if}
```

(Keep the node title line `{data.label || data.agentId}`, the session-mode toggle, the settings panel, and ALL Handle blocks exactly as they currently are.)

- [ ] **Step 3: Validate with the Svelte autofixer**

Use the Svelte MCP autofixer on `AgentNode.svelte`; fix any reported issues; re-run until clean.

- [ ] **Step 4: Type-check**

Run: `bun run check`
Expected: no NEW errors referencing AgentNode.svelte.

- [ ] **Step 5: Commit**

```bash
git add src/lib/components/flow-editor/nodes/AgentNode.svelte
git commit -m "feat(flow-editor): cascading type/instance dropdowns in AgentNode"
```

---

### Task 6: Palette — single Agent item; drop handler

**Files:**
- Modify: `src/lib/components/flow-editor/FlowSidebar.svelte`
- Modify: `src/lib/components/flow-editor/FlowCanvas.svelte`

Context: remove the per-agent palette listings (the `gw.agents` "Agents" section and the `builderState.agents` "Built Agents" section) from BOTH the expanded and collapsed views, and the `addAgentNode(agentId, label)` helper's call sites. Add one "Agent" palette item that drops a node with `agentKind` unset. Built agents still feed the Custom dropdown inside the node, so `loadBuiltAgents()` stays. Validate edited components with the Svelte autofixer.

- [ ] **Step 1: FlowSidebar — rework `addAgentNode` to a no-arg "blank agent"**

Replace the existing `addAgentNode(agentId, label)` function with:

```ts
  function addAgentNode() {
    const node: FlowNode = {
      id: makeId(),
      type: 'agent',
      position: getDropPosition(),
      data: {
        agentId: '',
        label: 'Agent',
        sessionMode: 'ephemeral',
        defaultValues: {},
        contextRules: [],
        inputHandles: [{ id: 'in', label: 'input' }],
        outputHandles: [{ id: 'out', label: 'output' }],
        contextHandles: [{ id: 'ctx', label: 'context' }],
      } satisfies AgentNodeData,
    };
    setNodes([...flowEditorState.nodes, node]);
  }
```

(Leave `agentKind` unset — the node's type dropdown sets it. The `contextHandles` label matches the existing default; keep whatever the file currently uses if it differs.)

- [ ] **Step 2: FlowSidebar — remove the two agent sections, add one Agent palette item**

In the EXPANDED view: delete the entire "Agents section" (`{m.flow_agents()}` heading + the `gw.agents` block incl. the empty-state) and the "Built Agents section" (`{m.flow_builtAgents()}` + `builderState.agents` block). In the Inputs section (next to Trigger / Prompt Box / LLM), add an Agent item:

```svelte
        <button
          onclick={addAgentNode}
          draggable="true"
          ondragstart={(e) => handleDragStart(e, { type: 'agent' })}
          class="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-left hover:bg-bg3 transition-colors border border-transparent hover:border-border/60"
        >
          <div class="w-6 h-6 rounded bg-indigo-500/20 flex items-center justify-center shrink-0">
            <Bot size={12} class="text-indigo-400" />
          </div>
          <div>
            <div class="text-xs font-medium text-foreground">Agent</div>
            <div class="text-[10px] text-muted">Custom / personal / drone</div>
          </div>
        </button>
```

In the COLLAPSED (icon-only) view: delete the `gw.agents` and `builderState.agents` icon loops; add a single Bot icon button that calls `addAgentNode` / `handleDragStart(e, { type: 'agent' })`.

Update `handleDragStart`'s payload param type so `{ type: 'agent' }` (no agentId) is valid — change the agent branch of the union to `{ type: 'agent' | 'promptBox' | 'llm' | 'trigger'; agentId?: string; label?: string }` (agentId already optional) — no change needed if agentId is already optional. Remove now-unused imports if `agentDisplayName` / `gw` are no longer referenced after deleting the sections (keep `builderState` + `loadBuiltAgents` — still used by the node; if the sidebar no longer references `builderState` directly, remove its import too, but keep `loadBuiltAgents` in onMount).

- [ ] **Step 3: FlowCanvas — agent drop branch builds a blank agent node**

Replace the existing `payload.type === 'agent'` drop branch (which required `payload.agentId`) with:

```ts
    } else if (payload.type === 'agent') {
      const node: FlowNode = {
        id: makeId(),
        type: 'agent',
        position,
        data: {
          agentId: '',
          label: 'Agent',
          sessionMode: 'ephemeral',
          defaultValues: {},
          contextRules: [],
          inputHandles: [{ id: 'in', label: 'input' }],
          outputHandles: [{ id: 'out', label: 'output' }],
          contextHandles: [{ id: 'ctx', label: 'context' }],
        } satisfies AgentNodeData,
      };
      setNodes([...flowEditorState.nodes, node]);
    }
```

The `handleDrop` payload type already includes `'agent'`; `agentId` is optional there — no type change needed. Ensure `AgentNodeData` is imported in FlowCanvas (it already imports `type AgentNodeData`).

- [ ] **Step 4: Validate edited components with the Svelte autofixer**

Run the autofixer on FlowSidebar.svelte and FlowCanvas.svelte; fix issues; re-run clean.

- [ ] **Step 5: Type-check**

Run: `bun run check`
Expected: no NEW errors referencing FlowSidebar.svelte / FlowCanvas.svelte. (If removing the agent sections left `agentDisplayName` or `gw` unused in FlowSidebar, delete those imports to avoid lint errors.)

- [ ] **Step 6: Commit**

```bash
git add src/lib/components/flow-editor/FlowSidebar.svelte src/lib/components/flow-editor/FlowCanvas.svelte
git commit -m "feat(flow-editor): single Agent palette item; remove per-agent sections"
```

---

## Final Verification (after all tasks)

- [ ] Gateway: `pnpm test` (drones.list green; full suite no regressions).
- [ ] Runtime: `npm test && npx tsc --noEmit` (agentKind/drone-guard tests green).
- [ ] Hub: `bun run check && bun run test` (new service + endpoint tests green; ≈18 pre-existing `$env/dynamic/private` failures unrelated).
- [ ] Manual E2E (hub dev server — RESTART first if it was running before these changes, per the dev-server HMR gotcha): open flow editor → one "Agent" palette item → drag it → Type=Custom lists gw+built agents; Type=Personal lists org users' personal agents by name; Type=Drone lists `summarize` + "coming soon" hint. promptBox→(custom agent) run returns a reply; drone-kind run shows the clear "not yet supported" error.
- [ ] Dispatch a final cross-repo code review.

---

## Notes for the Executor

- **Do not bump `@minion-stack/db` or any package version** — Changesets owns versioning.
- **Commit scope**: stage only the files named per task; never `git add -A`.
- **Branches**: gateway `DEV`, runtime `dev` (meta-repo), hub `dev`. Do not switch/merge branches.
- **Push is currently blocked** (SSH identity) — commits stay local. Do not push.
- **Svelte work**: use the svelte MCP autofixer on `.svelte` files (Svelte 5 runes only — `$props`, `$state`, `$derived`, `onclick=`).
- **No back-compat** for old saved agent nodes is an explicit decision — don't add migration shims.
- After deleting the palette sections, prune any now-unused imports in FlowSidebar.svelte to keep `bun run check` clean.
