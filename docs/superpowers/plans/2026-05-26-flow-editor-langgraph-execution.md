# Flow-Editor Execution via LangGraph Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a one-`promptBox`→one-`agent` flow execute for real — the hub POSTs the flow JSON to `langgraph-server`, which compiles it into a per-request LangGraph `StateGraph`, runs it against Claude, and streams output back into the flow-editor console (replacing the current mock).

**Architecture:** Two cooperating halves sharing one config value (the langgraph-server URL). `langgraph-server` gains a pure `compileFlow()` translator + a small Hono SSE endpoint `POST /flows/run`. `minion_hub` gains a pure SSE-stream parser + a `runFlow()` action wired into the existing `ConsolePanel`, plus an in-node agent/model picker. No DB schema change.

**Tech Stack:** `@langchain/langgraph` 1.3.1 (pinned — 1.3.2 has a thread-history regression), `@langchain/anthropic`, `zod` v4, Hono + `@hono/node-server` (new), `vitest` + `tsx` (new dev deps) on the server; SvelteKit 2 / Svelte 5 runes on the hub.

**Spec:** `minion_hub/docs/superpowers/specs/2026-05-26-flow-editor-langgraph-execution-design.md`

**Branch:** work off `dev` in both repos (hub workflow: feature branch off `dev`). `langgraph-server` is the meta-repo `langgraph-server/` dir.

---

## File Structure

**`langgraph-server/`**
- Create `src/flow/types.ts` — Flow JSON types (`FlowNode`, `FlowEdge`, `AgentNodeData`, `PromptBoxData`) + `FlowRunEvent` + `UnsupportedFlowError`. Mirrors the hub's shapes (no shared package yet).
- Create `src/flow/compile-flow.ts` — pure `compileFlow(nodes, edges, opts)` → `{ graph, initialState }`, `validateFlowShape`, `resolveModelId`.
- Create `src/flow/compile-flow.test.ts` — unit tests for compile + validation.
- Create `src/flow/server.ts` — Hono app + `@hono/node-server`, `POST /flows/run` streaming SSE.
- Create `vitest.config.ts` — node-environment vitest config.
- Modify `package.json` — add deps (`hono`, `@hono/node-server`), devDeps (`vitest`, `tsx`), scripts (`flows`, `test`).
- Modify `.env` / add `.env.example` note — `FLOWS_PORT` (optional, default 2025).

**`minion_hub/`**
- Create `src/lib/state/features/flow-run.ts` — framework-free `FlowRunEvent` type + `readSseStream()` async generator (pure, testable).
- Create `src/lib/state/features/flow-run.test.ts` — unit tests for the SSE parser.
- Modify `src/lib/state/features/flow-editor.svelte.ts` — add `isRunning` to state; add `runFlow()` action.
- Modify `src/lib/components/flow-editor/nodes/AgentNode.svelte` — add target picker `<select>`.
- Modify `src/routes/(app)/flow-editor/[id]/+page.svelte` — replace `handleTestRun` mock with `runFlow()`; bind button to `flowEditorState.isRunning`.
- Modify `.env.example` — add `PUBLIC_LANGGRAPH_FLOWS_URL`.

---

## Phase 1 — `langgraph-server`: flow types + tooling

### Task 1: Add test tooling and server deps

**Files:**
- Modify: `langgraph-server/package.json`
- Create: `langgraph-server/vitest.config.ts`

- [ ] **Step 1: Install deps**

Run:
```bash
cd langgraph-server
npm install hono @hono/node-server
npm install -D vitest tsx
```
Expected: installs succeed; `@langchain/langgraph` stays at `1.3.1` (do NOT let it bump).

- [ ] **Step 2: Add scripts to `package.json`**

In the `"scripts"` block, add:
```json
    "flows": "tsx src/flow/server.ts",
    "test": "vitest run",
    "test:watch": "vitest"
```

- [ ] **Step 3: Create `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
```

- [ ] **Step 4: Verify the test runner boots**

Run: `cd langgraph-server && npx vitest run`
Expected: exits 0 with "No test files found" (no tests yet).

- [ ] **Step 5: Commit**

```bash
git add langgraph-server/package.json langgraph-server/package-lock.json langgraph-server/vitest.config.ts
git commit -m "chore(langgraph-server): add vitest + hono tooling for flow execution"
```

### Task 2: Flow types module

**Files:**
- Create: `langgraph-server/src/flow/types.ts`

- [ ] **Step 1: Write the types**

```ts
// Flow JSON shapes — mirror of minion_hub's flow-editor types.
// Kept local (no shared package yet); see spec "Shared config".

export type HandleDef = { id: string; label: string };

export type AgentNodeData = {
  agentId: string;
  label: string;
  defaultValues?: Record<string, string>;
  contextRules?: unknown[];
  inputHandles?: HandleDef[];
  outputHandles?: HandleDef[];
  contextHandles?: HandleDef[];
};

export type PromptBoxData = {
  label: string;
  value: string;
};

export type FlowNode = {
  id: string;
  type: 'agent' | 'promptBox';
  position: { x: number; y: number };
  data: AgentNodeData | PromptBoxData;
};

export type FlowEdge = {
  id: string;
  source: string;
  sourceHandle: string;
  target: string;
  targetHandle: string;
  type: 'flow' | 'context';
  label?: string;
};

/** One streamed line of execution feedback, sent to the hub console. */
export type FlowRunEvent = {
  level: 'info' | 'warn' | 'error' | 'debug';
  message: string;
  nodeId?: string;
};

/** Thrown when a flow is not a shape the MVP runner can execute. */
export class UnsupportedFlowError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsupportedFlowError';
  }
}
```

- [ ] **Step 2: Verify it type-checks**

Run: `cd langgraph-server && npx tsc --noEmit`
Expected: PASS (no errors).

- [ ] **Step 3: Commit**

```bash
git add langgraph-server/src/flow/types.ts
git commit -m "feat(langgraph-server): add flow JSON types"
```

---

## Phase 2 — `langgraph-server`: the compiler (TDD)

### Task 3: `validateFlowShape` rejects unsupported flows

**Files:**
- Create: `langgraph-server/src/flow/compile-flow.ts`
- Create: `langgraph-server/src/flow/compile-flow.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect } from 'vitest';
import { validateFlowShape } from './compile-flow.js';
import { UnsupportedFlowError } from './types.js';
import type { FlowNode, FlowEdge } from './types.js';

const prompt: FlowNode = {
  id: 'p1', type: 'promptBox', position: { x: 0, y: 0 },
  data: { label: 'Prompt', value: 'Hello' },
};
const agent: FlowNode = {
  id: 'a1', type: 'agent', position: { x: 200, y: 0 },
  data: { agentId: 'claude-haiku-4-5-20251001', label: 'Agent' },
};
const edge: FlowEdge = {
  id: 'e1', source: 'p1', sourceHandle: 'prompt-out',
  target: 'a1', targetHandle: 'in', type: 'flow',
};

describe('validateFlowShape', () => {
  it('accepts one prompt connected to one agent', () => {
    expect(() => validateFlowShape([prompt, agent], [edge])).not.toThrow();
  });

  it('rejects a flow with no agent', () => {
    expect(() => validateFlowShape([prompt], [])).toThrow(UnsupportedFlowError);
  });

  it('rejects a flow with two agents', () => {
    const agent2 = { ...agent, id: 'a2' };
    expect(() => validateFlowShape([prompt, agent, agent2], [edge])).toThrow(UnsupportedFlowError);
  });

  it('rejects when prompt is not connected to the agent', () => {
    expect(() => validateFlowShape([prompt, agent], [])).toThrow(UnsupportedFlowError);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd langgraph-server && npx vitest run src/flow/compile-flow.test.ts`
Expected: FAIL — `validateFlowShape` is not exported / module missing.

- [ ] **Step 3: Implement `validateFlowShape` (minimal)**

Create `src/flow/compile-flow.ts`:
```ts
import { UnsupportedFlowError } from './types.js';
import type { FlowNode, FlowEdge } from './types.js';

const MVP_HINT =
  'MVP runner supports exactly one Prompt connected to one Agent.';

export function validateFlowShape(nodes: FlowNode[], edges: FlowEdge[]): void {
  const prompts = nodes.filter((n) => n.type === 'promptBox');
  const agents = nodes.filter((n) => n.type === 'agent');

  if (prompts.length !== 1) {
    throw new UnsupportedFlowError(
      `Expected exactly 1 prompt node, found ${prompts.length}. ${MVP_HINT}`,
    );
  }
  if (agents.length !== 1) {
    throw new UnsupportedFlowError(
      `Expected exactly 1 agent node, found ${agents.length}. ${MVP_HINT}`,
    );
  }

  const prompt = prompts[0];
  const agent = agents[0];
  const connected = edges.some(
    (e) => e.source === prompt.id && e.target === agent.id,
  );
  if (!connected) {
    throw new UnsupportedFlowError(
      `Prompt must be connected to the agent. ${MVP_HINT}`,
    );
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd langgraph-server && npx vitest run src/flow/compile-flow.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add langgraph-server/src/flow/compile-flow.ts langgraph-server/src/flow/compile-flow.test.ts
git commit -m "feat(langgraph-server): validate flow shape for MVP runner"
```

### Task 4: `compileFlow` builds a runnable StateGraph

**Files:**
- Modify: `langgraph-server/src/flow/compile-flow.ts`
- Modify: `langgraph-server/src/flow/compile-flow.test.ts`

- [ ] **Step 1: Add the failing test (uses an injected fake model)**

Append to `compile-flow.test.ts`:
```ts
import { compileFlow, resolveModelId } from './compile-flow.js';
import { AIMessage, HumanMessage, type BaseMessage } from '@langchain/core/messages';

describe('compileFlow', () => {
  it('seeds the prompt value and runs the agent node', async () => {
    const fakeModel = {
      async invoke(messages: BaseMessage[]) {
        const last = messages[messages.length - 1];
        return new AIMessage(`echo:${String(last.content)}`);
      },
    };

    const { graph, initialState } = compileFlow([prompt, agent], [edge], {
      model: fakeModel,
    });

    expect(initialState.messages[0]).toBeInstanceOf(HumanMessage);
    expect(initialState.messages[0].content).toBe('Hello');

    const result = await graph.invoke(initialState);
    const final = result.messages[result.messages.length - 1];
    expect(final.content).toBe('echo:Hello');
  });

  it('throws on an unsupported flow before building a graph', () => {
    expect(() => compileFlow([prompt], [], {})).toThrow(UnsupportedFlowError);
  });
});

describe('resolveModelId', () => {
  it('passes through a claude model id', () => {
    expect(resolveModelId('claude-haiku-4-5-20251001')).toBe('claude-haiku-4-5-20251001');
  });
  it('falls back to the default for non-model ids', () => {
    expect(resolveModelId('built:abc123')).toBe('claude-haiku-4-5-20251001');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd langgraph-server && npx vitest run src/flow/compile-flow.test.ts`
Expected: FAIL — `compileFlow` / `resolveModelId` not exported.

- [ ] **Step 3: Implement `compileFlow` + `resolveModelId`**

Append to `src/flow/compile-flow.ts`:
```ts
import { ChatAnthropic } from '@langchain/anthropic';
import { MessagesAnnotation, StateGraph } from '@langchain/langgraph';
import { HumanMessage, type BaseMessage } from '@langchain/core/messages';
import type { AgentNodeData, PromptBoxData } from './types.js';

const DEFAULT_MODEL = 'claude-haiku-4-5-20251001';

/** MVP: the picker writes a model id into agentId; non-model ids fall back. */
export function resolveModelId(agentId: string): string {
  return agentId.startsWith('claude-') ? agentId : DEFAULT_MODEL;
}

interface ChatModel {
  invoke(messages: BaseMessage[]): Promise<BaseMessage>;
}

export interface CompileOptions {
  /** Inject a model for tests; defaults to a real ChatAnthropic. */
  model?: ChatModel;
}

export function compileFlow(
  nodes: FlowNode[],
  edges: FlowEdge[],
  opts: CompileOptions = {},
) {
  validateFlowShape(nodes, edges);

  const promptNode = nodes.find((n) => n.type === 'promptBox')!;
  const agentNode = nodes.find((n) => n.type === 'agent')!;
  const promptValue = (promptNode.data as PromptBoxData).value ?? '';
  const modelId = resolveModelId((agentNode.data as AgentNodeData).agentId);

  const model: ChatModel =
    opts.model ?? new ChatAnthropic({ model: modelId, temperature: 0 });

  const callAgent = async (state: typeof MessagesAnnotation.State) => {
    const response = await model.invoke(state.messages);
    return { messages: [response] };
  };

  const graph = new StateGraph(MessagesAnnotation)
    .addNode('agent', callAgent)
    .addEdge('__start__', 'agent')
    .addEdge('agent', '__end__')
    .compile();

  const initialState = { messages: [new HumanMessage(promptValue)] };

  return { graph, initialState };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd langgraph-server && npx vitest run src/flow/compile-flow.test.ts`
Expected: PASS (all tests).

- [ ] **Step 5: Type-check**

Run: `cd langgraph-server && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add langgraph-server/src/flow/compile-flow.ts langgraph-server/src/flow/compile-flow.test.ts
git commit -m "feat(langgraph-server): compile flow JSON to a per-request StateGraph"
```

---

## Phase 3 — `langgraph-server`: HTTP endpoint

### Task 5: `POST /flows/run` streams SSE

**Files:**
- Create: `langgraph-server/src/flow/server.ts`

- [ ] **Step 1: Write the server**

```ts
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { streamSSE } from 'hono/streaming';
import { z } from 'zod';
import { AIMessage } from '@langchain/core/messages';
import { compileFlow } from './compile-flow.js';
import { UnsupportedFlowError, type FlowNode, type FlowEdge, type FlowRunEvent } from './types.js';

const FlowRunRequest = z.object({
  nodes: z.array(
    z.object({
      id: z.string(),
      type: z.enum(['agent', 'promptBox']),
      position: z.object({ x: z.number(), y: z.number() }),
      data: z.record(z.string(), z.unknown()),
    }),
  ),
  edges: z.array(
    z.object({
      id: z.string(),
      source: z.string(),
      sourceHandle: z.string(),
      target: z.string(),
      targetHandle: z.string(),
      type: z.enum(['flow', 'context']),
      label: z.string().optional(),
    }),
  ),
});

const app = new Hono();
app.use('/*', cors());

app.get('/health', (c) => c.json({ ok: true }));

app.post('/flows/run', async (c) => {
  const parsed = FlowRunRequest.safeParse(await c.req.json().catch(() => null));

  return streamSSE(c, async (stream) => {
    const send = (e: FlowRunEvent) => stream.writeSSE({ data: JSON.stringify(e) });

    if (!parsed.success) {
      await send({ level: 'error', message: 'Invalid flow payload.' });
      await stream.writeSSE({ event: 'done', data: '{}' });
      return;
    }

    const nodes = parsed.data.nodes as FlowNode[];
    const edges = parsed.data.edges as FlowEdge[];

    try {
      await send({ level: 'info', message: 'Starting flow run…' });
      const { graph, initialState } = compileFlow(nodes, edges);
      await send({ level: 'debug', message: 'Compiled flow to StateGraph.' });

      for await (const chunk of await graph.stream(initialState, {
        streamMode: 'values',
      })) {
        const messages = chunk.messages ?? [];
        const last = messages[messages.length - 1];
        if (last instanceof AIMessage && last.content) {
          await send({ level: 'info', message: String(last.content) });
        }
      }

      await send({ level: 'info', message: 'Flow run complete.' });
    } catch (err) {
      const message =
        err instanceof UnsupportedFlowError
          ? err.message
          : `Flow run failed: ${err instanceof Error ? err.message : String(err)}`;
      await send({ level: 'error', message });
    } finally {
      await stream.writeSSE({ event: 'done', data: '{}' });
    }
  });
});

const port = Number(process.env.FLOWS_PORT ?? 2025);
serve({ fetch: app.fetch, port });
console.log(`[flows] listening on http://localhost:${port}`);
```

- [ ] **Step 2: Type-check**

Run: `cd langgraph-server && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Smoke-test the endpoint manually**

Run (terminal A): `cd langgraph-server && npm run flows`
Expected: logs `[flows] listening on http://localhost:2025`.

Run (terminal B):
```bash
curl -N -X POST http://localhost:2025/flows/run \
  -H 'Content-Type: application/json' \
  -d '{"nodes":[{"id":"p1","type":"promptBox","position":{"x":0,"y":0},"data":{"label":"Prompt","value":"Say hi in 3 words"}},{"id":"a1","type":"agent","position":{"x":200,"y":0},"data":{"agentId":"claude-haiku-4-5-20251001","label":"Agent"}}],"edges":[{"id":"e1","source":"p1","sourceHandle":"prompt-out","target":"a1","targetHandle":"in","type":"flow"}]}'
```
Expected: a stream of `data: {...}` lines ending with an `event: done` line; one `info` line contains the model's reply. (Requires `ANTHROPIC_API_KEY` in `langgraph-server/.env`.)

Stop terminal A when done (Ctrl-C).

- [ ] **Step 4: Commit**

```bash
git add langgraph-server/src/flow/server.ts
git commit -m "feat(langgraph-server): add POST /flows/run SSE endpoint"
```

---

## Phase 4 — `minion_hub`: SSE parser (TDD)

### Task 6: `readSseStream` parses the flow-run stream

**Files:**
- Create: `minion_hub/src/lib/state/features/flow-run.ts`
- Create: `minion_hub/src/lib/state/features/flow-run.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { readSseStream, type FlowRunEvent } from './flow-run';

function streamFrom(text: string): ReadableStream<Uint8Array> {
  const bytes = new TextEncoder().encode(text);
  return new ReadableStream({
    start(controller) {
      // emit in two chunks to exercise buffering across boundaries
      const mid = Math.floor(bytes.length / 2);
      controller.enqueue(bytes.slice(0, mid));
      controller.enqueue(bytes.slice(mid));
      controller.close();
    },
  });
}

describe('readSseStream', () => {
  it('parses data events in order and stops at done', async () => {
    const sse =
      'data: {"level":"info","message":"Starting flow run…"}\n\n' +
      'data: {"level":"info","message":"Hello there"}\n\n' +
      'event: done\ndata: {}\n\n';

    const events: FlowRunEvent[] = [];
    for await (const e of readSseStream(streamFrom(sse))) {
      events.push(e);
    }

    expect(events).toEqual([
      { level: 'info', message: 'Starting flow run…' },
      { level: 'info', message: 'Hello there' },
    ]);
  });

  it('ignores malformed data lines', async () => {
    const sse = 'data: not-json\n\ndata: {"level":"warn","message":"ok"}\n\nevent: done\ndata: {}\n\n';
    const events: FlowRunEvent[] = [];
    for await (const e of readSseStream(streamFrom(sse))) events.push(e);
    expect(events).toEqual([{ level: 'warn', message: 'ok' }]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd minion_hub && bun run vitest run src/lib/state/features/flow-run.test.ts`
Expected: FAIL — module/`readSseStream` missing.

- [ ] **Step 3: Implement the parser**

```ts
// Framework-free SSE parsing for the flow runner. No Svelte runes here so it
// is trivially unit-testable; flow-editor.svelte.ts consumes this.

export type FlowRunEvent = {
  level: 'info' | 'warn' | 'error' | 'debug';
  message: string;
  nodeId?: string;
};

/**
 * Reads an SSE byte stream and yields each `data:` payload as a FlowRunEvent.
 * Stops yielding when the terminal `event: done` frame is seen. Malformed
 * JSON payloads are skipped.
 */
export async function* readSseStream(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<FlowRunEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let sep: number;
      while ((sep = buffer.indexOf('\n\n')) !== -1) {
        const frame = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);

        const isDone = frame.split('\n').some((l) => l === 'event: done');
        if (isDone) return;

        const dataLine = frame.split('\n').find((l) => l.startsWith('data: '));
        if (!dataLine) continue;
        const raw = dataLine.slice('data: '.length);
        try {
          const parsed = JSON.parse(raw);
          if (parsed && typeof parsed.message === 'string') {
            yield parsed as FlowRunEvent;
          }
        } catch {
          // skip malformed frame
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd minion_hub && bun run vitest run src/lib/state/features/flow-run.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add minion_hub/src/lib/state/features/flow-run.ts minion_hub/src/lib/state/features/flow-run.test.ts
git commit -m "feat(hub): add SSE parser for flow runner output"
```

---

## Phase 5 — `minion_hub`: wire execution into the editor

### Task 7: Add `isRunning` state + `runFlow()` action

**Files:**
- Modify: `minion_hub/src/lib/state/features/flow-editor.svelte.ts`
- Modify: `minion_hub/.env.example`

- [ ] **Step 1: Add `isRunning` to the state object**

In `flow-editor.svelte.ts`, inside the `flowEditorState = $state({ ... })` object, add after `isSaving: false,`:
```ts
  isRunning: false,
```

- [ ] **Step 2: Add the `runFlow` action at the end of the file**

Append to `flow-editor.svelte.ts`:
```ts
import { readSseStream } from './flow-run';
import { env } from '$env/dynamic/public';

const FLOWS_URL = env.PUBLIC_LANGGRAPH_FLOWS_URL ?? 'http://localhost:2025';

export async function runFlow() {
  if (flowEditorState.isRunning) return;
  flowEditorState.isRunning = true;
  flowEditorState.consoleOpen = true;
  clearLogs();

  try {
    const res = await fetch(`${FLOWS_URL}/flows/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nodes: flowEditorState.nodes,
        edges: flowEditorState.edges,
      }),
    });

    if (!res.ok || !res.body) {
      appendLog({ level: 'error', message: `Flow runner returned ${res.status}.` });
      return;
    }

    for await (const event of readSseStream(res.body)) {
      appendLog({ level: event.level, message: event.message, nodeId: event.nodeId });
    }
  } catch {
    appendLog({ level: 'error', message: `Could not reach flow runner at ${FLOWS_URL}.` });
  } finally {
    flowEditorState.isRunning = false;
  }
}
```

> Note: `import` statements must sit at the top of the module. Move the two new
> `import` lines to join the existing imports at the top of the file rather than
> leaving them above the function — they are shown here next to their use only
> for clarity.

- [ ] **Step 3: Add the env var to `.env.example`**

Append to `minion_hub/.env.example`:
```
# LangGraph flow runner (langgraph-server) — used by the flow editor "Run" button
PUBLIC_LANGGRAPH_FLOWS_URL=http://localhost:2025
```

- [ ] **Step 4: Type-check**

Run: `cd minion_hub && bun run check`
Expected: PASS (no new errors in `flow-editor.svelte.ts`).

- [ ] **Step 5: Commit**

```bash
git add minion_hub/src/lib/state/features/flow-editor.svelte.ts minion_hub/.env.example
git commit -m "feat(hub): add runFlow() that streams langgraph-server output to console"
```

### Task 8: Replace the mock run with `runFlow()` in the page

**Files:**
- Modify: `minion_hub/src/routes/(app)/flow-editor/[id]/+page.svelte`

- [ ] **Step 1: Update imports**

Change the import from `flow-editor.svelte` to add `runFlow` and drop now-unused `appendLog`/`clearLogs` if no longer referenced:
```ts
  import {
    flowEditorState,
    loadFlow,
    saveFlow,
    runFlow,
    deleteNode,
    duplicateNode,
  } from '$lib/state/features/flow-editor.svelte';
```
(Remove the separate `appendLog, clearLogs` import and the duplicate `deleteNode, duplicateNode` import line at the bottom of the original `<script>`.)

- [ ] **Step 2: Delete the mock `handleTestRun` and local `isRunning`**

Remove the `let isRunning = $state(false);` line and the entire `async function handleTestRun() { ... }` block (lines ~19 and ~23-44 of the original). Keep `destroyed`/`onDestroy` only if still used elsewhere; if nothing else uses them, remove them too.

- [ ] **Step 3: Point the button at `runFlow` and the shared state**

Change the Test Run button:
```svelte
      <button
        onclick={runFlow}
        disabled={flowEditorState.isRunning}
        class="flex items-center gap-1.5 h-7 px-3 text-xs rounded border transition-colors
          border-emerald-500/50 text-emerald-400 hover:bg-emerald-500/10 disabled:opacity-50 disabled:cursor-default"
      >
        {#if flowEditorState.isRunning}
          <Loader size={12} class="animate-spin" />
        {:else}
          <Play size={12} />
        {/if}
        {m.flow_testRun()}
      </button>
```

- [ ] **Step 4: Type-check**

Run: `cd minion_hub && bun run check`
Expected: PASS — no unused-variable or missing-import errors for this file.

- [ ] **Step 5: Commit**

```bash
git add "minion_hub/src/routes/(app)/flow-editor/[id]/+page.svelte"
git commit -m "feat(hub): wire flow-editor Run button to real langgraph execution"
```

### Task 9: Agent node target picker

**Files:**
- Modify: `minion_hub/src/lib/components/flow-editor/nodes/AgentNode.svelte`

- [ ] **Step 1: Add the picker options + change handler in `<script>`**

After the existing `let { data, id, selected } = $props();` line, add:
```ts
  import { setNodes, flowEditorState as fs } from '$lib/state/features/flow-editor.svelte';

  // MVP: execution is direct-LLM, so the picker chooses a model id, written into
  // the existing agentId/label fields. Later phases will list real gw/built agents.
  const MODEL_OPTIONS = [
    { id: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5' },
    { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
    { id: 'claude-opus-4-7', label: 'Claude Opus 4.7' },
  ];

  function pickModel(e: Event) {
    const modelId = (e.target as HTMLSelectElement).value;
    const label = MODEL_OPTIONS.find((o) => o.id === modelId)?.label ?? modelId;
    const next = fs.nodes.map((n) =>
      n.id === id ? { ...n, data: { ...n.data, agentId: modelId, label } } : n,
    );
    setNodes(next);
  }
```

- [ ] **Step 2: Add the `<select>` to the node body**

Inside the node body `<div>`, replace the `{#if data.agentId}…{/if}` block (the mono agentId line) with a picker:
```svelte
  <select
    class="mt-1 w-full text-[10px] bg-bg3 border border-border rounded px-1 py-0.5 text-foreground"
    value={data.agentId}
    onclick={(e) => e.stopPropagation()}
    onchange={pickModel}
  >
    {#each MODEL_OPTIONS as opt (opt.id)}
      <option value={opt.id}>{opt.label}</option>
    {/each}
    {#if data.agentId && !MODEL_OPTIONS.some((o) => o.id === data.agentId)}
      <option value={data.agentId}>{data.label}</option>
    {/if}
  </select>
```
(The `onclick` stop-propagation prevents the node's drag/select from eating the dropdown click.)

- [ ] **Step 3: Type-check**

Run: `cd minion_hub && bun run check`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add minion_hub/src/lib/components/flow-editor/nodes/AgentNode.svelte
git commit -m "feat(hub): add model picker to flow-editor agent node"
```

---

## Phase 6 — End-to-end verification

### Task 10: Manual end-to-end run

**Files:** none (verification only)

- [ ] **Step 1: Start the flow runner**

Run (terminal A): `cd langgraph-server && npm run flows`
Expected: `[flows] listening on http://localhost:2025`. (Needs `ANTHROPIC_API_KEY` in its `.env`.)

- [ ] **Step 2: Start the hub**

Run (terminal B): `cd minion_hub && bun run dev`
Expected: dev server URL printed.

- [ ] **Step 3: Drive the UI**

In the browser: open the flow editor, create/open a flow, drag in a Prompt node and an Agent node, type a prompt (e.g. "List 3 colors"), connect Prompt → Agent, pick a model in the agent node, click Run.
Expected: the console opens and shows `Starting flow run…`, then the model's actual reply text, then `Flow run complete.` The button shows a spinner while running and re-enables after.

- [ ] **Step 4: Verify the unsupported-flow path**

Delete the connecting edge, click Run.
Expected: a red error log: "Prompt must be connected to the agent. MVP runner supports exactly one Prompt connected to one Agent."

- [ ] **Step 5: Run the full automated test suites**

Run:
```bash
cd langgraph-server && npm run test
cd ../minion_hub && bun run vitest run src/lib/state/features/flow-run.test.ts
```
Expected: all PASS.

- [ ] **Step 6: Final commit (if any verification fixes were needed)**

```bash
git add -A
git commit -m "test: verify flow-editor langgraph execution end-to-end"
```

---

## Self-Review Notes

- **Spec coverage:** compileFlow (Task 3-4), separate HTTP endpoint / compile-per-request (Task 5), hub runFlow + SSE (Task 6-7), mock replacement (Task 8), agent picker (Task 9), shared config env var (Task 7), no schema change (honored — no migration tasks), error handling for unsupported shape + transport (Tasks 3/5/6/7/10), tests (Tasks 3,4,6,10). North-star plugin packaging intentionally NOT in the plan (out of MVP scope per spec).
- **Type consistency:** `FlowRunEvent` shape `{ level, message, nodeId? }` identical on both sides; `compileFlow` returns `{ graph, initialState }` used verbatim in Task 5; `runFlow`/`isRunning` names consistent across Tasks 7-8.
- **Deferred (acknowledged in spec):** Hono chosen over Node `http`; finer per-token streaming; real gateway-agent routing — all explicitly later-phase.
