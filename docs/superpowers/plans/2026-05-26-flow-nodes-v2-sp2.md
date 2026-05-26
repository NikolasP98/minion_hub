# Flow Nodes v2 — SP-2: Trigger Nodes from Gateway Hooks

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make flows fire automatically when gateway hook events occur (message received, agent bootstrap, memory changes, etc.), with an optional deliver-to-channel response.

**Architecture:** The hub registers active trigger flows with the gateway via RPC (`flows.trigger.register`). The gateway registers in-process hook handlers that call `POST /flows/run-triggered` on langgraph-server when events fire. langgraph-server fetches the flow from the hub, compiles it with the event payload as the initial message, and returns the reply. The gateway optionally delivers the reply back to the originating channel session.

**Tech Stack:** Same three repos as SP-1: `langgraph-server` (Node ESM + vitest), `minion_hub` (SvelteKit 2 + Svelte 5 + Drizzle + bun), `minion/` (gateway, pnpm + vitest). The hub is its own git repo (branch `dev`). The gateway is its own git repo (branch `DEV`). langgraph-server commits go to the meta-repo at `/home/nikolas/Documents/CODE/MINION` (branch `dev`).

**Spec:** `minion_hub/docs/superpowers/specs/2026-05-26-flow-nodes-v2-sp2-design.md`

---

## File Structure

**`langgraph-server/`** (meta-repo)
- Modify: `src/flow/types.ts` — add `TriggerNodeData`, add `'trigger'` to `FlowNode.type`
- Modify: `src/flow/compile-flow.ts` — extend `validateFlowShape` + `compileFlow` for trigger node; add `initialPrompt` to `CompileOptions`
- Modify: `src/flow/compile-flow.test.ts` — add trigger node tests
- Modify: `src/flow/server.ts` — add `POST /flows/run-triggered` endpoint; add `HUB_URL`/`HUB_API_TOKEN` env
- Modify: `.env` — add `HUB_URL`, `HUB_API_TOKEN`

**`minion_hub/`** (own repo)
- Modify: `src/server/db/schema/flows.ts` — add `active` + `config` columns
- Modify: `src/routes/api/flows/+server.ts` — extend GET to support `?active=true`
- Modify: `src/routes/api/flows/[id]/+server.ts` — extend PUT to persist `active`
- Create: `src/routes/api/internal/flows/[id]/+server.ts` — internal endpoint for langgraph-server to fetch flow JSON (Bearer token auth)
- Modify: `src/lib/state/features/flow-editor.svelte.ts` — add `TriggerNodeData`; update `FlowNode` type
- Create: `src/lib/components/flow-editor/nodes/TriggerNode.svelte`
- Modify: `src/routes/(app)/flow-editor/[id]/+page.svelte` — activate/deactivate toolbar button
- Modify: `src/lib/services/gateway.svelte.ts` — re-register active triggers on connect
- Modify: `src/lib/components/flow-editor/FlowSidebar.svelte` — Trigger palette item
- Modify: `src/lib/components/flow-editor/FlowCanvas.svelte` — add `trigger` nodeType + drop handler

**`minion/`** (gateway, own repo)
- Create: `src/flows/trigger-manager.ts` — registry, hook handlers, HTTP dispatch to langgraph-server
- Create: `src/flows/trigger-manager.test.ts`
- Create: `src/gateway/server-methods/flows-trigger.ts` — gateway RPC handler factory
- Modify: `src/gateway/server.impl.ts` — spread `createFlowsTriggerHandlers()` into `extraHandlers`

---

## Task 1: langgraph-server — types + compileFlow trigger support (TDD)

**Files:**
- Modify: `langgraph-server/src/flow/types.ts`
- Modify: `langgraph-server/src/flow/compile-flow.ts`
- Modify: `langgraph-server/src/flow/compile-flow.test.ts`

- [ ] **Step 1: Read current types.ts and compile-flow.ts**

```bash
cat /home/nikolas/Documents/CODE/MINION/langgraph-server/src/flow/types.ts
cat /home/nikolas/Documents/CODE/MINION/langgraph-server/src/flow/compile-flow.ts
```

- [ ] **Step 2: Add `TriggerNodeData` and `'trigger'` to `FlowNode` in `types.ts`**

Add after `LLMNodeData`:
```ts
export type TriggerNodeData = {
  event: 'message:received' | 'message:sent' | 'agent:bootstrap'
        | 'memory:node_created' | 'memory:node_updated' | 'memory:node_deleted';
  label: string;
  deliverResponse: boolean;
  filterChannelId?: string;
  filterAgentId?: string;
};
```

Update `FlowNode`:
```ts
export type FlowNode = {
  id: string;
  type: 'agent' | 'promptBox' | 'llm' | 'trigger';
  position: { x: number; y: number };
  data: AgentNodeData | PromptBoxData | LLMNodeData | TriggerNodeData;
};
```

- [ ] **Step 3: Write failing tests for trigger node shapes**

Read the current `compile-flow.test.ts` to understand existing imports and fixtures. **Append** these new describe blocks (do NOT remove existing tests). Also add `import type { TriggerNodeData }` to the imports:

```ts
// ── Trigger node ──────────────────────────────────────────────────────────────

const triggerNode: FlowNode = {
  id: 't1', type: 'trigger', position: { x: 0, y: 0 },
  data: {
    event: 'message:received',
    label: 'Message received',
    deliverResponse: false,
  } satisfies TriggerNodeData,
};
const edgeFromTrigger: FlowEdge = {
  id: 'e-t', source: 't1', sourceHandle: 'out',
  target: 'l1', targetHandle: 'in', type: 'flow',
};

describe('validateFlowShape — trigger nodes', () => {
  it('accepts one trigger connected to one llm node', () => {
    expect(() => validateFlowShape([triggerNode, llmNode], [edgeFromTrigger])).not.toThrow();
  });

  it('rejects trigger + promptBox together', () => {
    const edgePrompt: FlowEdge = { id: 'ep', source: 'p1', sourceHandle: 'prompt-out', target: 'l1', targetHandle: 'in', type: 'flow' };
    expect(() => validateFlowShape([triggerNode, prompt, llmNode], [edgeFromTrigger, edgePrompt])).toThrow(UnsupportedFlowError);
  });

  it('rejects two execution nodes: trigger + agent', () => {
    expect(() => validateFlowShape([triggerNode, llmNode, agent], [edgeFromTrigger])).toThrow(UnsupportedFlowError);
  });
});

describe('compileFlow — trigger node', () => {
  it('uses initialPrompt from opts when trigger node is present', async () => {
    const fakeModel = {
      async invoke(messages: BaseMessage[]) {
        const last = messages[messages.length - 1];
        return new AIMessage(`trigger-echo:${String(last.content)}`);
      },
    };
    const { graph, initialState } = compileFlow([triggerNode, llmNode], [edgeFromTrigger], {
      model: fakeModel,
      initialPrompt: 'event payload text',
    });
    expect(initialState.messages[0]).toBeInstanceOf(HumanMessage);
    expect(initialState.messages[0].content).toBe('event payload text');
    const result = await graph.invoke(initialState);
    expect(result.messages[result.messages.length - 1].content).toBe('trigger-echo:event payload text');
  });

  it('throws when trigger node present but initialPrompt not provided', () => {
    expect(() => compileFlow([triggerNode, llmNode], [edgeFromTrigger], {})).toThrow(UnsupportedFlowError);
  });
});
```

- [ ] **Step 4: Run to verify new tests fail**

```bash
cd /home/nikolas/Documents/CODE/MINION/langgraph-server && npx vitest run src/flow/compile-flow.test.ts 2>&1 | tail -8
```
Expected: existing tests pass; new trigger tests FAIL.

- [ ] **Step 5: Update `compile-flow.ts`**

Add `initialPrompt?: string` to `CompileOptions`:
```ts
export interface CompileOptions {
  model?: ChatModel;
  gatewayClient?: GatewayClient;
  initialPrompt?: string;   // required when the flow has a trigger node (comes from event payload)
}
```

Update `validateFlowShape` to handle trigger nodes. Replace the current `execNodes` filter line and error messages:

```ts
export function validateFlowShape(nodes: FlowNode[], edges: FlowEdge[]): void {
  const prompts = nodes.filter((n) => n.type === 'promptBox');
  const triggers = nodes.filter((n) => n.type === 'trigger');
  const execNodes = nodes.filter((n) => n.type === 'agent' || n.type === 'llm');

  const MVP_HINT = 'MVP runner supports exactly one Prompt (or Trigger) connected to one Agent or LLM node.';

  if (prompts.length > 0 && triggers.length > 0) {
    throw new UnsupportedFlowError('A flow cannot have both a trigger and a prompt box.');
  }
  if (triggers.length > 1) {
    throw new UnsupportedFlowError(`Expected exactly 1 trigger node, found ${triggers.length}. ${MVP_HINT}`);
  }
  const entryNodes = [...prompts, ...triggers];
  if (entryNodes.length !== 1) {
    throw new UnsupportedFlowError(`Expected exactly 1 prompt or trigger node, found ${entryNodes.length}. ${MVP_HINT}`);
  }
  if (execNodes.length !== 1) {
    throw new UnsupportedFlowError(`Expected exactly 1 agent or LLM node, found ${execNodes.length}. ${MVP_HINT}`);
  }
  const entry = entryNodes[0];
  const exec = execNodes[0];
  const connected = edges.some((e) => e.source === entry.id && e.target === exec.id && e.type === 'flow');
  if (!connected) {
    throw new UnsupportedFlowError(`Entry node must be connected to the agent or LLM. ${MVP_HINT}`);
  }
}
```

Update `compileFlow` to handle the trigger node entry point:

```ts
export function compileFlow(nodes: FlowNode[], edges: FlowEdge[], opts: CompileOptions = {}) {
  validateFlowShape(nodes, edges);

  const entryNode = nodes.find((n) => n.type === 'promptBox' || n.type === 'trigger')!;
  const execNode = nodes.find((n) => n.type === 'agent' || n.type === 'llm')!;
  const runId = randomUUID();

  let promptValue: string;
  if (entryNode.type === 'trigger') {
    if (!opts.initialPrompt) {
      throw new UnsupportedFlowError(
        'Trigger node requires an initialPrompt (event payload) — call via /flows/run-triggered.',
      );
    }
    promptValue = opts.initialPrompt;
  } else {
    promptValue = ((entryNode.data as import('./types.js').PromptBoxData).value) ?? '';
  }

  const callNode = buildExecNode(execNode, opts, runId);

  const graph = new StateGraph(MessagesAnnotation)
    .addNode('exec', callNode)
    .addEdge('__start__', 'exec')
    .addEdge('exec', '__end__')
    .compile();

  const initialState = { messages: [new HumanMessage(promptValue)] };
  return { graph, initialState };
}
```

Also update the MVP_HINT constant — it's now inside `validateFlowShape`. Remove the top-level `const MVP_HINT` (it's defined inline in the new `validateFlowShape`).

- [ ] **Step 6: Run all tests**

```bash
cd /home/nikolas/Documents/CODE/MINION/langgraph-server && npm run test
```
Expected: all tests PASS (trigger tests + all 25 previous = ~30 total). Also run `npx tsc --noEmit` → PASS.

- [ ] **Step 7: Commit (meta-repo, scope to two files)**

```bash
cd /home/nikolas/Documents/CODE/MINION
git add langgraph-server/src/flow/types.ts langgraph-server/src/flow/compile-flow.ts langgraph-server/src/flow/compile-flow.test.ts
git commit -m "feat(langgraph-server): trigger node type + compileFlow support for event-driven flows

Co-Authored-By: Claude Sonnet 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: langgraph-server — `POST /flows/run-triggered` endpoint

**Files:**
- Modify: `langgraph-server/src/flow/server.ts`
- Modify: `langgraph-server/.env`

- [ ] **Step 1: Read current server.ts**

```bash
cat /home/nikolas/Documents/CODE/MINION/langgraph-server/src/flow/server.ts
```

- [ ] **Step 2: Add `POST /flows/run-triggered` route**

Add after the existing `app.post('/flows/run', ...)` handler. The endpoint fetches the flow JSON from the hub, compiles and invokes it, and returns JSON `{ reply }`:

```ts
const TriggeredRunRequest = z.object({
  flowId: z.string(),
  prompt: z.string(),
  eventPayload: z.record(z.string(), z.unknown()).optional(),
  sessionKey: z.string().optional(),
});

app.post('/flows/run-triggered', async (c) => {
  const parsed = TriggeredRunRequest.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ error: 'Invalid request payload.' }, 400);
  }
  const { flowId, prompt } = parsed.data;

  const HUB_URL = process.env.HUB_URL ?? 'http://localhost:5173';
  const HUB_API_TOKEN = process.env.HUB_API_TOKEN ?? '';

  // Fetch flow from hub
  let nodes: import('./types.js').FlowNode[];
  let edges: import('./types.js').FlowEdge[];
  try {
    const res = await fetch(`${HUB_URL}/api/internal/flows/${flowId}`, {
      headers: HUB_API_TOKEN ? { Authorization: `Bearer ${HUB_API_TOKEN}` } : {},
    });
    if (!res.ok) {
      return c.json({ error: `Hub returned ${res.status} for flow ${flowId}` }, 502);
    }
    const body = await res.json() as { nodes: import('./types.js').FlowNode[]; edges: import('./types.js').FlowEdge[] };
    nodes = body.nodes;
    edges = body.edges;
  } catch (err) {
    return c.json({ error: `Hub unreachable: ${err instanceof Error ? err.message : String(err)}` }, 503);
  }

  // Compile and run
  try {
    const { graph, initialState } = compileFlow(nodes, edges, { initialPrompt: prompt });
    const result = await graph.invoke(initialState);
    const lastMessage = result.messages[result.messages.length - 1];
    const reply = String(lastMessage?.content ?? '');
    return c.json({ reply });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return c.json({ error: `Flow run failed: ${message}` }, 500);
  }
});
```

Add `compileFlow` to the imports at the top if not already imported:
```ts
import { compileFlow } from './compile-flow.js';
```

- [ ] **Step 3: Add env vars to `.env`**

Append to `langgraph-server/.env`:
```
# Hub connection (for fetching flow JSON in triggered runs)
HUB_URL=http://localhost:5173
HUB_API_TOKEN=
```

- [ ] **Step 4: Smoke test the new endpoint**

Start the server (terminal A): `cd /home/nikolas/Documents/CODE/MINION/langgraph-server && npm run flows`

Test with an invalid flowId (hub not running — should return 503):
```bash
curl -s -X POST http://localhost:2025/flows/run-triggered \
  -H 'Content-Type: application/json' \
  -d '{"flowId":"nonexistent","prompt":"hello"}'
```
Expected: `{"error":"Hub unreachable: ..."}`  (503 or similar — confirms the endpoint exists and the hub-fetch path runs).

Kill the server when done.

- [ ] **Step 5: Run full suite**

```bash
cd /home/nikolas/Documents/CODE/MINION/langgraph-server && npm run test && npx tsc --noEmit
```
Expected: all tests PASS, tsc PASS.

- [ ] **Step 6: Commit**

```bash
cd /home/nikolas/Documents/CODE/MINION
git add langgraph-server/src/flow/server.ts langgraph-server/.env
git commit -m "feat(langgraph-server): add POST /flows/run-triggered endpoint for event-driven execution

Co-Authored-By: Claude Sonnet 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: minion_hub — DB migration (active + config columns)

**Files:**
- Modify: `minion_hub/src/server/db/schema/flows.ts`

- [ ] **Step 1: Read current schema**

```bash
cat /home/nikolas/Documents/CODE/MINION/minion_hub/src/server/db/schema/flows.ts
```

- [ ] **Step 2: Add the two new columns**

```ts
export const flows = sqliteTable('flows', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  nodes: text('nodes').notNull().default('[]'),
  edges: text('edges').notNull().default('[]'),
  userId: text('user_id'),
  tenantId: text('tenant_id'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
  active: integer('active', { mode: 'boolean' }).notNull().default(false),  // NEW
  config: text('config').notNull().default('{}'),                            // NEW
});
```

- [ ] **Step 3: Push schema + verify**

```bash
cd /home/nikolas/Documents/CODE/MINION/minion_hub && bun run db:push
```
Expected: schema applied successfully. New columns exist with safe defaults.

Then verify the columns exist:
```bash
bun -e '
import { Database } from "bun:sqlite";
const db = new Database("./data/minion_hub.db", { readonly: true });
console.log(db.query("PRAGMA table_info(flows)").all().map(c => c.name + ":" + c.type));
'
```
Expected: output includes `active:INTEGER` and `config:TEXT`.

- [ ] **Step 4: Type-check**

```bash
cd /home/nikolas/Documents/CODE/MINION/minion_hub && bun run check 2>&1 | grep -iE 'flows\.ts' | head -10 || echo "no errors in flows schema"
```

- [ ] **Step 5: Commit (minion_hub repo)**

```bash
cd /home/nikolas/Documents/CODE/MINION/minion_hub
git add src/server/db/schema/flows.ts
git commit -m "feat(hub): add active + config columns to flows table for trigger arming

Co-Authored-By: Claude Sonnet 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: minion_hub — Hub API changes (GET ?active, PUT active, internal GET)

**Files:**
- Modify: `minion_hub/src/routes/api/flows/+server.ts`
- Modify: `minion_hub/src/routes/api/flows/[id]/+server.ts`
- Create: `minion_hub/src/routes/api/internal/flows/[id]/+server.ts`

- [ ] **Step 1: Read the current API files**

```bash
cat /home/nikolas/Documents/CODE/MINION/minion_hub/src/routes/api/flows/+server.ts
cat /home/nikolas/Documents/CODE/MINION/minion_hub/src/routes/api/flows/[id]/+server.ts
```

- [ ] **Step 2: Extend `GET /api/flows` to support `?active=true`**

In `src/routes/api/flows/+server.ts`, find the `GET` handler. After fetching the flows list, add filtering:

```ts
export const GET: RequestHandler = async ({ locals, url }) => {
  // ... existing auth/tenantCtx setup ...

  const activeOnly = url.searchParams.get('active') === 'true';
  let rows = await ctx.db.select().from(flows).where(
    and(
      or(eq(flows.userId, user.id), isNull(flows.userId)),
      activeOnly ? eq(flows.active, true) : undefined,
    )
  );
  // ... rest of handler (map to response shape, include active field) ...
};
```

Also ensure the response includes the `active` field:
```ts
return json({
  flows: rows.map((f) => ({
    ...f,
    nodes: JSON.parse(f.nodes),
    edges: JSON.parse(f.edges),
    active: f.active,         // include in listing
  })),
});
```

- [ ] **Step 3: Extend `PUT /api/flows/[id]` to persist `active`**

In `src/routes/api/flows/[id]/+server.ts`, find the `PUT` handler body parse and update section. Add `active` to accepted fields:

```ts
  const { name, nodes, edges, active } = body as {
    name?: string; nodes?: unknown[]; edges?: unknown[]; active?: boolean;
  };

  const updates: Record<string, unknown> = { updatedAt: Date.now() };
  if (name !== undefined) updates.name = name;
  if (nodes !== undefined) updates.nodes = JSON.stringify(nodes);
  if (edges !== undefined) updates.edges = JSON.stringify(edges);
  if (active !== undefined) updates.active = active;   // NEW
```

Also update the `GET /api/flows/[id]` response to include `active`:
```ts
  return json({
    flow: {
      ...flow,
      nodes: JSON.parse(flow.nodes),
      edges: JSON.parse(flow.edges),
      active: flow.active,    // include so the editor can show activate state
    },
  });
```

- [ ] **Step 4: Create the internal endpoint**

Create `src/routes/api/internal/flows/[id]/+server.ts`:

```ts
import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { flows } from '@minion-stack/db/schema';
import { eq } from 'drizzle-orm';
import { getDb } from '$server/db/client';
import { env } from '$env/static/private';

/**
 * Internal endpoint for langgraph-server to fetch flow nodes+edges by ID.
 * Requires Authorization: Bearer <HUB_API_TOKEN>.
 * Bypasses user auth — intended for server-to-server calls only.
 */
export const GET: RequestHandler = async ({ params, request }) => {
  // Validate Bearer token
  const authHeader = request.headers.get('Authorization') ?? '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  const expectedToken = env.HUB_API_TOKEN ?? '';

  // If no token configured, allow unauthenticated access on local dev
  if (expectedToken && token !== expectedToken) {
    throw error(401, 'Unauthorized');
  }

  const db = getDb();
  const [flow] = await db.select().from(flows).where(eq(flows.id, params.id!)).limit(1);
  if (!flow) throw error(404, 'Flow not found');

  return json({
    nodes: JSON.parse(flow.nodes),
    edges: JSON.parse(flow.edges),
  });
};
```

Add `HUB_API_TOKEN` to `minion_hub/.env.example`:
```
# Shared secret for langgraph-server → hub internal API
HUB_API_TOKEN=
```

- [ ] **Step 5: Type-check**

```bash
cd /home/nikolas/Documents/CODE/MINION/minion_hub && bun run check 2>&1 | grep -iE 'internal|flows/\[id\]|flows/\+server' | head -15 || echo "no errors in changed files"
```

- [ ] **Step 6: Commit**

```bash
cd /home/nikolas/Documents/CODE/MINION/minion_hub
git add src/routes/api/flows/+server.ts src/routes/api/flows/[id]/+server.ts src/routes/api/internal/flows/[id]/+server.ts .env.example
git commit -m "feat(hub): extend flows API for trigger activation; add internal flow fetch endpoint

Co-Authored-By: Claude Sonnet 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: minion_hub — TypeScript types + `TriggerNode.svelte`

**Files:**
- Modify: `minion_hub/src/lib/state/features/flow-editor.svelte.ts`
- Create: `minion_hub/src/lib/components/flow-editor/nodes/TriggerNode.svelte`

- [ ] **Step 1: Update `flow-editor.svelte.ts`**

Read the file, then add `TriggerNodeData` after `LLMNodeData`:
```ts
export type TriggerNodeData = {
  event: 'message:received' | 'message:sent' | 'agent:bootstrap'
        | 'memory:node_created' | 'memory:node_updated' | 'memory:node_deleted';
  label: string;
  deliverResponse: boolean;
  filterChannelId?: string;
  filterAgentId?: string;
};
```

Update `FlowNode`:
```ts
export type FlowNode = {
  id: string;
  type: 'agent' | 'promptBox' | 'llm' | 'trigger';
  position: { x: number; y: number };
  data: AgentNodeData | PromptBoxData | LLMNodeData | TriggerNodeData;
};
```

- [ ] **Step 2: Create `TriggerNode.svelte`**

This is a Svelte 5 component. Run the Svelte autofixer MCP tool after writing.

```svelte
<script lang="ts">
  import { Handle, Position } from '@xyflow/svelte';
  import type { NodeProps } from '@xyflow/svelte';
  import type { TriggerNodeData } from '$lib/state/features/flow-editor.svelte';
  import { flowEditorState, setNodes } from '$lib/state/features/flow-editor.svelte';
  import { Zap } from 'lucide-svelte';

  let { data, id }: NodeProps & { data: TriggerNodeData } = $props();

  const EVENT_LABELS: Record<TriggerNodeData['event'], string> = {
    'message:received': 'Message received',
    'message:sent': 'Message sent',
    'agent:bootstrap': 'Agent bootstrap',
    'memory:node_created': 'Memory created',
    'memory:node_updated': 'Memory updated',
    'memory:node_deleted': 'Memory deleted',
  };

  function updateField<K extends keyof TriggerNodeData>(key: K, value: TriggerNodeData[K]) {
    const next = flowEditorState.nodes.map((n) =>
      n.id === id ? { ...n, data: { ...n.data, [key]: value } } : n,
    );
    setNodes(next);
  }

  function handleEventChange(e: Event) {
    const event = (e.target as HTMLSelectElement).value as TriggerNodeData['event'];
    const label = EVENT_LABELS[event];
    const next = flowEditorState.nodes.map((n) =>
      n.id === id ? { ...n, data: { ...n.data, event, label } } : n,
    );
    setNodes(next);
  }

  function handleDeliverChange(e: Event) {
    updateField('deliverResponse', (e.target as HTMLInputElement).checked);
  }
</script>

<Handle
  type="source"
  position={Position.Right}
  id="out"
  class="!w-3 !h-3 !border-2 !border-amber-400 !bg-amber-900"
/>

<div
  class="relative bg-bg2 border rounded-xl px-4 py-3 min-w-48 max-w-60 shadow-lg select-none border-border hover:border-border/80"
>
  <div class="flex items-center gap-2 mb-2">
    <div class="w-6 h-6 rounded-md bg-amber-500/20 flex items-center justify-center shrink-0">
      <Zap size={12} class="text-amber-400" />
    </div>
    <span class="text-xs font-semibold text-foreground">Trigger</span>
  </div>

  <select
    class="w-full text-[10px] bg-bg3 border border-border rounded px-1 py-0.5 text-foreground mb-2"
    value={data.event}
    onclick={(e) => e.stopPropagation()}
    onchange={handleEventChange}
  >
    {#each Object.entries(EVENT_LABELS) as [val, lbl] (val)}
      <option value={val}>{lbl}</option>
    {/each}
  </select>

  <label class="flex items-center gap-1.5 cursor-pointer" onclick={(e) => e.stopPropagation()}>
    <input
      type="checkbox"
      class="w-3 h-3 accent-amber-400"
      checked={data.deliverResponse}
      onchange={handleDeliverChange}
    />
    <span class="text-[10px] text-muted">Reply to channel</span>
  </label>
</div>
```

- [ ] **Step 3: Validate with Svelte autofixer MCP**

Load `mcp__plugin_svelte_svelte__svelte-autofixer` via ToolSearch, then pass the full component content. Fix any reported issues.

- [ ] **Step 4: Type-check**

```bash
cd /home/nikolas/Documents/CODE/MINION/minion_hub && bun run check 2>&1 | grep -iE 'TriggerNode|flow-editor\.svelte' | head -10 || echo "no errors"
```

- [ ] **Step 5: Commit**

```bash
cd /home/nikolas/Documents/CODE/MINION/minion_hub
git add src/lib/state/features/flow-editor.svelte.ts src/lib/components/flow-editor/nodes/TriggerNode.svelte
git commit -m "feat(hub): add TriggerNodeData type + TriggerNode.svelte component

Co-Authored-By: Claude Sonnet 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: minion_hub — Activate button + gateway re-registration + palette wiring

**Files:**
- Modify: `minion_hub/src/routes/(app)/flow-editor/[id]/+page.svelte`
- Modify: `minion_hub/src/lib/services/gateway.svelte.ts`
- Modify: `minion_hub/src/lib/components/flow-editor/FlowSidebar.svelte`
- Modify: `minion_hub/src/lib/components/flow-editor/FlowCanvas.svelte`

- [ ] **Step 1: Read all four files**

```bash
cat "/home/nikolas/Documents/CODE/MINION/minion_hub/src/routes/(app)/flow-editor/[id]/+page.svelte"
grep -n "onHelloOk\|agents.list\|flows" /home/nikolas/Documents/CODE/MINION/minion_hub/src/lib/services/gateway.svelte.ts | head -20
cat /home/nikolas/Documents/CODE/MINION/minion_hub/src/lib/components/flow-editor/FlowSidebar.svelte
grep -n "nodeTypes\|LLMNode\|handleDrop\|llm" /home/nikolas/Documents/CODE/MINION/minion_hub/src/lib/components/flow-editor/FlowCanvas.svelte | head -20
```

- [ ] **Step 2: Add Activate/Deactivate button to the page toolbar**

In `flow-editor/[id]/+page.svelte`:

Add import at the top (in the existing import block from `flow-editor.svelte`):
```ts
  import { flowEditorState, loadFlow, saveFlow, runFlow, deleteNode, duplicateNode } from '$lib/state/features/flow-editor.svelte';
  import { sendRequest } from '$lib/services/gateway.svelte';
```

Add state + handlers after the existing `let isRunning`-removed block:
```ts
  let isActivating = $state(false);
  const hasTrigger = $derived(flowEditorState.nodes.some((n) => n.type === 'trigger'));
  const isActive = $derived(!!flowEditorState.flowActive);

  async function handleActivate() {
    if (isActivating || !flowEditorState.flowId) return;
    isActivating = true;
    try {
      const newActive = !isActive;
      await fetch(`/api/flows/${flowEditorState.flowId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ active: newActive }),
      });
      flowEditorState.flowActive = newActive;

      const triggerNode = flowEditorState.nodes.find((n) => n.type === 'trigger');
      if (!triggerNode) return;
      const td = triggerNode.data as import('$lib/state/features/flow-editor.svelte').TriggerNodeData;

      if (newActive) {
        await sendRequest('flows.trigger.register', {
          flowId: flowEditorState.flowId,
          event: td.event,
          deliverResponse: td.deliverResponse,
          filterChannelId: td.filterChannelId,
          filterAgentId: td.filterAgentId,
        });
      } else {
        await sendRequest('flows.trigger.unregister', { flowId: flowEditorState.flowId });
      }
    } finally {
      isActivating = false;
    }
  }
```

Add `flowActive: false` to the `flowEditorState` object in `flow-editor.svelte.ts` (add alongside `isRunning`).

In the toolbar template, add the Activate button next to Test Run (only shown when `hasTrigger`):
```svelte
      {#if hasTrigger}
        <button
          onclick={handleActivate}
          disabled={isActivating}
          class="flex items-center gap-1.5 h-7 px-3 text-xs rounded border transition-colors
            {isActive
              ? 'border-red-500/50 text-red-400 hover:bg-red-500/10'
              : 'border-amber-500/50 text-amber-400 hover:bg-amber-500/10'}
            disabled:opacity-50 disabled:cursor-default"
        >
          {isActive ? 'Deactivate' : 'Activate'}
        </button>
      {/if}
```

Also update `loadFlow` to read the `active` field from the API response and set `flowEditorState.flowActive`.

- [ ] **Step 3: Re-register active triggers on gateway connect**

In `src/lib/services/gateway.svelte.ts`, find the `onHelloOk` function (or wherever `agents.list` is called on connect). Add re-registration after it:

```ts
    // Re-register any active trigger flows
    fetch('/api/flows?active=true')
      .then((r) => r.json())
      .then(async (body: { flows?: Array<{id: string; nodes: unknown[]; active: boolean}> }) => {
        for (const flow of body.flows ?? []) {
          const triggerNode = (flow.nodes as Array<{type: string; data: unknown}>)
            .find((n) => n.type === 'trigger');
          if (!triggerNode) continue;
          const td = triggerNode.data as import('$lib/state/features/flow-editor.svelte').TriggerNodeData;
          await sendRequest('flows.trigger.register', {
            flowId: flow.id,
            event: td.event,
            deliverResponse: td.deliverResponse,
            filterChannelId: td.filterChannelId,
            filterAgentId: td.filterAgentId,
          }).catch(() => { /* gateway may not have the method yet — silent */ });
        }
      })
      .catch(() => { /* non-fatal — hub may not be ready */ });
```

- [ ] **Step 4: Add Trigger to FlowSidebar and FlowCanvas**

In `FlowSidebar.svelte`:
- Import `Zap` from `lucide-svelte`
- Import `TriggerNodeData` from flow-editor state
- Add `addTriggerNode()` function:
```ts
  function addTriggerNode() {
    const node: FlowNode = {
      id: makeId(),
      type: 'trigger',
      position: getDropPosition(),
      data: {
        event: 'message:received',
        label: 'Message received',
        deliverResponse: false,
      } satisfies TriggerNodeData,
    };
    setNodes([...flowEditorState.nodes, node]);
  }
```
- Add `'trigger'` to `handleDragStart` payload type
- Add Trigger button at the TOP of the INPUTS section in both expanded and collapsed sidebars (amber color, `Zap` icon, title "Trigger")

In `FlowCanvas.svelte`:
- Import `TriggerNode from './nodes/TriggerNode.svelte'`
- Import `TriggerNodeData` from flow-editor state
- Add `trigger: TriggerNode` to `nodeTypes`
- Add `'trigger'` to the drop handler payload type
- Add `trigger` branch in `handleDrop`:
```ts
    } else if (payload.type === 'trigger') {
      const node: FlowNode = {
        id: makeId(),
        type: 'trigger',
        position,
        data: {
          event: 'message:received',
          label: 'Message received',
          deliverResponse: false,
        } satisfies TriggerNodeData,
      };
      setNodes([...flowEditorState.nodes, node]);
    }
```

- [ ] **Step 5: Run Svelte autofixer on modified .svelte files**

Run the MCP autofixer on `+page.svelte`, `FlowSidebar.svelte`, and `FlowCanvas.svelte`. Fix any issues.

- [ ] **Step 6: Type-check**

```bash
cd /home/nikolas/Documents/CODE/MINION/minion_hub && bun run check 2>&1 | grep -iE 'TriggerNode|flow-editor/\[id\]|FlowSidebar|FlowCanvas' | head -20 || echo "no errors in changed files"
```

- [ ] **Step 7: Commit**

```bash
cd /home/nikolas/Documents/CODE/MINION/minion_hub
git add "src/routes/(app)/flow-editor/[id]/+page.svelte" src/lib/services/gateway.svelte.ts src/lib/components/flow-editor/FlowSidebar.svelte src/lib/components/flow-editor/FlowCanvas.svelte src/lib/state/features/flow-editor.svelte.ts
git commit -m "feat(hub): activate/deactivate trigger flows; Trigger palette + nodeType; re-register on gateway connect

Co-Authored-By: Claude Sonnet 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Gateway — trigger manager (TDD)

**Files:**
- Create: `minion/src/flows/trigger-manager.ts`
- Create: `minion/src/flows/trigger-manager.test.ts`

**GIT NOTE:** The gateway lives at `/home/nikolas/Documents/CODE/MINION/minion/` — its own git repo on branch `DEV`. Scope all commits to only files in `minion/src/flows/`. Do NOT use `git add -A`.

- [ ] **Step 1: Write failing tests**

Create `minion/src/flows/trigger-manager.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  register,
  unregister,
  list,
  extractPrompt,
  type TriggerRegistration,
} from './trigger-manager.js';

describe('extractPrompt', () => {
  it('extracts content from message:received', () => {
    expect(extractPrompt(
      { type: 'message', sessionKey: 'sk', context: { content: 'hello world', channelId: 'telegram' }, timestamp: new Date(), action: 'received', messages: [] },
      'message:received',
    )).toBe('hello world');
  });

  it('extracts content from message:sent', () => {
    expect(extractPrompt(
      { type: 'message', sessionKey: 'sk', context: { content: 'reply text', channelId: 'discord' }, timestamp: new Date(), action: 'sent', messages: [] },
      'message:sent',
    )).toBe('reply text');
  });

  it('generates summary for agent:bootstrap', () => {
    const result = extractPrompt(
      { type: 'agent', sessionKey: 'session-123', context: { agentId: 'PANIK' }, timestamp: new Date(), action: 'bootstrap', messages: [] },
      'agent:bootstrap',
    );
    expect(result).toContain('PANIK');
    expect(result).toContain('session-123');
  });

  it('generates summary for memory:node_created', () => {
    const result = extractPrompt(
      { type: 'memory', sessionKey: '', context: { label: 'UserProfile', data: { name: 'Alice' } }, timestamp: new Date(), action: 'node_created', messages: [] },
      'memory:node_created',
    );
    expect(result).toContain('UserProfile');
    expect(result).toContain('Alice');
  });
});

describe('register / unregister / list', () => {
  beforeEach(() => {
    // Clear the registry between tests
    for (const reg of list()) unregister(reg.flowId);
  });

  it('registers and lists a trigger', () => {
    register({ flowId: 'flow-1', event: 'message:received', deliverResponse: false });
    expect(list()).toHaveLength(1);
    expect(list()[0].flowId).toBe('flow-1');
  });

  it('replaces existing registration for the same flowId (idempotent)', () => {
    register({ flowId: 'flow-1', event: 'message:received', deliverResponse: false });
    register({ flowId: 'flow-1', event: 'message:sent', deliverResponse: true });
    expect(list()).toHaveLength(1);
    expect(list()[0].event).toBe('message:sent');
  });

  it('unregisters a flow', () => {
    register({ flowId: 'flow-1', event: 'message:received', deliverResponse: false });
    unregister('flow-1');
    expect(list()).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run to verify tests fail**

```bash
cd /home/nikolas/Documents/CODE/MINION/minion && pnpm vitest run src/flows/trigger-manager.test.ts 2>&1 | tail -8
```
Expected: FAIL — module not found.

- [ ] **Step 3: Create `trigger-manager.ts`**

Create `minion/src/flows/trigger-manager.ts`:
```ts
import { registerInternalHook } from '../hooks/internal-hooks.js';
import type { InternalHookEvent } from '../hooks/internal-hooks.js';
import { createSubsystemLogger } from '../logging/subsystem.js';

const log = createSubsystemLogger('flows:trigger');

export type TriggerEventKey =
  | 'message:received' | 'message:sent' | 'agent:bootstrap'
  | 'memory:node_created' | 'memory:node_updated' | 'memory:node_deleted';

export type TriggerRegistration = {
  flowId: string;
  event: TriggerEventKey;
  deliverResponse: boolean;
  filterChannelId?: string;
  filterAgentId?: string;
};

const registry = new Map<string, TriggerRegistration>();

export function register(reg: TriggerRegistration): void {
  registry.set(reg.flowId, reg);
  log.debug(`[flows] Registered trigger for flow ${reg.flowId} on ${reg.event}`);
}

export function unregister(flowId: string): void {
  registry.delete(flowId);
  log.debug(`[flows] Unregistered trigger for flow ${flowId}`);
}

export function list(): TriggerRegistration[] {
  return [...registry.values()];
}

// Exported for tests — extracts the relevant prompt from an event.
export function extractPrompt(event: InternalHookEvent, eventKey: TriggerEventKey): string {
  const ctx = event.context;
  switch (eventKey) {
    case 'message:received':
    case 'message:sent':
      return String(ctx.content ?? '');
    case 'agent:bootstrap':
      return `Agent ${String(ctx.agentId ?? 'unknown')} bootstrapped for session ${event.sessionKey}`;
    case 'memory:node_created':
      return `New memory: ${String(ctx.label ?? 'unknown')} — ${JSON.stringify(ctx.data ?? {})}`;
    case 'memory:node_updated':
      return `Memory updated: ${String(ctx.label ?? 'unknown')} — ${JSON.stringify(ctx.data ?? {})}`;
    case 'memory:node_deleted':
      return `Memory deleted: ${String(ctx.label ?? 'unknown')}`;
  }
}

async function fireFlow(flowId: string, reg: TriggerRegistration, prompt: string, event: InternalHookEvent): Promise<void> {
  const FLOWS_RUNNER_URL = process.env.FLOWS_RUNNER_URL ?? 'http://localhost:2025';
  try {
    const res = await fetch(`${FLOWS_RUNNER_URL}/flows/run-triggered`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        flowId,
        prompt,
        eventPayload: event.context,
        sessionKey: event.sessionKey,
      }),
    });
    if (!res.ok) {
      log.warn(`[flows] run-triggered failed for ${flowId}: ${res.status}`);
      return;
    }
    const { reply } = await res.json() as { reply?: string };

    if (reg.deliverResponse && reply && event.sessionKey) {
      // TODO: trace gateway delivery API (minion/src/infra/outbound/deliver.ts)
      // to deliver reply to the originating session.
      // For now, log the intended delivery.
      log.info(`[flows] Would deliver to session ${event.sessionKey}: ${reply.slice(0, 80)}...`);
    }
  } catch (err) {
    log.error(`[flows] Error firing trigger for ${flowId}: ${String(err)}`);
  }
}

async function handleTriggerEvent(event: InternalHookEvent, eventKey: TriggerEventKey): Promise<void> {
  for (const [flowId, reg] of registry.entries()) {
    if (reg.event !== eventKey) continue;
    if (reg.filterChannelId && event.context.channelId !== reg.filterChannelId) continue;
    if (reg.filterAgentId && event.context.agentId !== reg.filterAgentId) continue;
    const prompt = extractPrompt(event, eventKey);
    void fireFlow(flowId, reg, prompt, event);   // fire-and-forget
  }
}

const SUPPORTED_EVENTS: TriggerEventKey[] = [
  'message:received', 'message:sent', 'agent:bootstrap',
  'memory:node_created', 'memory:node_updated', 'memory:node_deleted',
];

/** Call once at gateway startup to register all event handlers. */
export function initializeTriggerHandlers(): void {
  for (const key of SUPPORTED_EVENTS) {
    registerInternalHook(key, (event) => void handleTriggerEvent(event, key));
  }
  log.info('[flows] Trigger handlers initialized');
}
```

**Note on `deliverResponse`:** The delivery back to the originating channel is a stub (logs instead of delivering). Tracing the gateway delivery API and wiring it up is a follow-up (see `minion/src/infra/outbound/deliver.ts`). The fetch call to langgraph-server IS fully implemented.

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd /home/nikolas/Documents/CODE/MINION/minion && pnpm vitest run src/flows/trigger-manager.test.ts 2>&1 | tail -8
```
Expected: PASS (7 tests).

Run full test suite: `pnpm test` → existing tests still pass.

- [ ] **Step 5: Commit (gateway's own repo on branch DEV)**

```bash
cd /home/nikolas/Documents/CODE/MINION/minion
git add src/flows/trigger-manager.ts src/flows/trigger-manager.test.ts
git commit -m "feat(gateway): flow trigger manager — registry + hook handlers + langgraph-server dispatch

Co-Authored-By: Claude Sonnet 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: Gateway — RPC methods + server.impl.ts wiring

**Files:**
- Create: `minion/src/gateway/server-methods/flows-trigger.ts`
- Modify: `minion/src/gateway/server.impl.ts`

**GIT NOTE:** Gateway repo at `/home/nikolas/Documents/CODE/MINION/minion/` on branch `DEV`.

- [ ] **Step 1: Read server.impl.ts around the extraHandlers block**

```bash
sed -n '940,965p' /home/nikolas/Documents/CODE/MINION/minion/src/gateway/server.impl.ts
```
Find the `const extraHandlers: ... = { ... }` block — this is where we add our handlers.

- [ ] **Step 2: Create `flows-trigger.ts` handler factory**

Create `minion/src/gateway/server-methods/flows-trigger.ts`:
```ts
import { register, unregister, list, initializeTriggerHandlers, type TriggerRegistration } from '../../flows/trigger-manager.js';
import type { GatewayRequestHandlers } from './types.js';

let initialized = false;

/**
 * Returns gateway RPC handlers for flows.trigger.* methods.
 * Also initializes the trigger hook handlers (once) as a side-effect.
 */
export function createFlowsTriggerHandlers(): GatewayRequestHandlers {
  if (!initialized) {
    initializeTriggerHandlers();
    initialized = true;
  }

  return {
    'flows.trigger.register': async ({ params, respond }) => {
      try {
        const reg = params as TriggerRegistration;
        if (!reg?.flowId || !reg?.event) {
          respond({ ok: false, error: 'Missing flowId or event' });
          return;
        }
        register(reg);
        respond({ ok: true });
      } catch (err) {
        respond({ ok: false, error: String(err) });
      }
    },

    'flows.trigger.unregister': async ({ params, respond }) => {
      const { flowId } = (params ?? {}) as { flowId?: string };
      if (flowId) unregister(flowId);
      respond({ ok: true });
    },

    'flows.trigger.list': async ({ respond }) => {
      respond({ triggers: list() });
    },
  };
}
```

- [ ] **Step 3: Wire into `server.impl.ts`**

Find the existing imports of handler factories in `server.impl.ts` (e.g. `createSecretsHandlers`, `createShellsHandlers`, `createMyAgentHandlers`). Add the import for the new factory:
```ts
import { createFlowsTriggerHandlers } from './server-methods/flows-trigger.js';
```

Find the `const extraHandlers: ... = { ... }` block and spread in the new handlers:
```ts
  const extraHandlers: import('./server-methods/types.js').GatewayRequestHandlers = {
    ...pluginRegistry.gatewayHandlers,
    ...execApprovalHandlers,
    ...createSecretsHandlers({ secrets: secretsManager }),
    ...createShellsHandlers({ shells: shellsManager }),
    ...createMyAgentHandlers({ secrets: secretsManager }),
    ...createFlowsTriggerHandlers(),   // ← add this line
  };
```

- [ ] **Step 4: Add env var to gateway config**

Find where the gateway reads its env (likely `src/infra/env.ts` or config). Add a note about `FLOWS_RUNNER_URL`. If the gateway has an `.env.example` or similar, add:
```
FLOWS_RUNNER_URL=http://localhost:2025
```

- [ ] **Step 5: Build check**

```bash
cd /home/nikolas/Documents/CODE/MINION/minion && pnpm build 2>&1 | tail -10 || pnpm tsgo 2>&1 | tail -10
```
Expected: no TypeScript errors for the new files (check for errors in flows-trigger.ts and server.impl.ts).

Run `pnpm test` to confirm existing tests pass.

- [ ] **Step 6: Commit**

```bash
cd /home/nikolas/Documents/CODE/MINION/minion
git add src/gateway/server-methods/flows-trigger.ts src/gateway/server.impl.ts
git commit -m "feat(gateway): register flows.trigger.* RPC methods + initialize hook handlers at startup

Co-Authored-By: Claude Sonnet 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: E2E verification

- [ ] **Step 1: Run all automated suites**

```bash
cd /home/nikolas/Documents/CODE/MINION/langgraph-server && npm run test
cd /home/nikolas/Documents/CODE/MINION/minion && pnpm test
cd /home/nikolas/Documents/CODE/MINION/minion_hub && bun run vitest run src/lib/state/features/flow-run.test.ts
```
Expected: all PASS.

- [ ] **Step 2: Test `/flows/run-triggered` with a real flow**

Start the langgraph-server flows endpoint and the hub dev server. Seed the PONG demo flow id (from earlier session, it's `44d52549-5d94-42d5-998e-aa59829d949d` in the local DB with a promptBox + LLM node). Update it to a trigger flow for this test:

```bash
# start hub
cd /home/nikolas/Documents/CODE/MINION/minion_hub && (bun run dev >/tmp/hub-sp2.log 2>&1 &) ; sleep 8

# start flows runner (terminal B)
cd /home/nikolas/Documents/CODE/MINION/langgraph-server && (npm run flows >/tmp/flows-sp2.log 2>&1 &) ; sleep 3
```

Seed a new trigger flow in the local DB:
```bash
cd /home/nikolas/Documents/CODE/MINION/minion_hub
bun -e '
import { Database } from "bun:sqlite";
import { randomUUID } from "node:crypto";
const db = new Database("./data/minion_hub.db");
const id = randomUUID();
const promptId = "tp-" + randomUUID().slice(0,8);
const llmId = "tl-" + randomUUID().slice(0,8);
const nodes = [
  { id: promptId, type: "trigger", position: { x: 0, y: 0 }, data: { event: "message:received", label: "Message received", deliverResponse: false } },
  { id: llmId, type: "llm", position: { x: 300, y: 0 }, data: { modelId: "openai/gpt-4o-mini", label: "GPT-4o mini" } },
];
const edges = [{ id: "te1", source: promptId, sourceHandle: "out", target: llmId, targetHandle: "in", type: "flow" }];
const now = Math.floor(Date.now()/1000);
db.run("insert into flows (id,name,nodes,edges,created_at,updated_at,active) values (?,?,?,?,?,?,?)",
  [id, "Trigger test", JSON.stringify(nodes), JSON.stringify(edges), now, now, 0]);
console.log("trigger flow id:", id);
'
```

Call `/flows/run-triggered` with the new flow id:
```bash
curl -s -X POST http://localhost:2025/flows/run-triggered \
  -H 'Content-Type: application/json' \
  -d "{\"flowId\":\"<ID-from-above>\",\"prompt\":\"hello from event\",\"eventPayload\":{\"channelId\":\"telegram\"}}"
```
Expected: `{"reply":"<model response>"}` (a non-empty reply from the model).

- [ ] **Step 3: Test validation error (trigger + promptBox together)**

```bash
curl -s -X POST http://localhost:2025/flows/run-triggered \
  -H 'Content-Type: application/json' \
  -d '{"flowId":"nonexistent-flow","prompt":"test"}'
```
Expected: `{"error":"Hub returned 404 for flow nonexistent-flow"}` or similar 502.

- [ ] **Step 4: Kill servers**

```bash
kill $(lsof -ti:5173 2>/dev/null) $(lsof -ti:2025 2>/dev/null) 2>/dev/null
echo "ports free"
```

- [ ] **Step 5: Verify hub UI**

Start hub dev server. Open the flow editor with the trigger test flow. Confirm:
- "Trigger" appears at the top of the INPUTS palette
- Dropping/clicking creates a trigger node with the event picker and "Reply to channel" checkbox
- The toolbar shows "Activate" button only when a trigger node is present
- Clicking Activate calls the gateway RPC and flips the flow's active state

---

## Self-Review Notes

**Spec coverage:**
- ✅ `TriggerNodeData` type — Tasks 1, 5
- ✅ `validateFlowShape` accepts trigger + exec (rejects trigger + promptBox) — Task 1
- ✅ `compileFlow` with `initialPrompt` for trigger flows — Task 1
- ✅ `POST /flows/run-triggered` endpoint — Task 2
- ✅ Hub internal endpoint for flow fetch — Task 4
- ✅ DB migration (active + config columns) — Task 3
- ✅ PUT extends active — Task 4; GET ?active=true — Task 4
- ✅ TriggerNode.svelte component — Task 5
- ✅ Activate/deactivate toolbar button — Task 6
- ✅ Re-registration on gateway connect — Task 6
- ✅ FlowSidebar Trigger item + FlowCanvas nodeType — Task 6
- ✅ `trigger-manager.ts` (register/unregister/list/extractPrompt/fireFlow) — Task 7
- ✅ `flows.trigger.register/unregister/list` RPC methods — Task 8
- ✅ `initializeTriggerHandlers()` called at gateway startup — Task 8

**Known stub:** `deliverResponse=true` logs the intended reply but does not yet deliver to the channel (requires tracing `minion/src/infra/outbound/deliver.ts`). Documented in trigger-manager.ts with a TODO comment.

**Type consistency:** `TriggerRegistration` defined in trigger-manager.ts (Task 7) and used verbatim in flows-trigger.ts (Task 8). `TriggerNodeData` defined in both langgraph-server/types.ts (Task 1) and hub flow-editor.svelte.ts (Task 5) — identical shapes, kept local per the SP-1 convention.
