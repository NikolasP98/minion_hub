# Flow Nodes v2 — SP-1: LLM Node + Real-Agent Node Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the MVP's conflated `agent` node into a dedicated `llm` node (model-only, always available, backed by OpenRouter or Anthropic) and a real `agent` node (routes turns to a connected gateway agent over WS), resolving the "No agents connected" UX gap.

**Architecture:** langgraph-server gains a thin persistent WebSocket client that authenticates with the minion gateway and routes agent turns via `chat.send`; a provider factory chooses OpenRouter (default) or Anthropic based on env vars; `compileFlow` is extended to handle both `llm` and `agent` node types. The hub gains a new `LLMNode.svelte` component and reworks `AgentNode.svelte` to show real gateway agents plus a per-node session-mode toggle.

**Tech Stack:** `ws` (WS client in langgraph-server), `@langchain/openai` (OpenRouter via ChatOpenAI), Svelte 5 runes, vitest, `@xyflow/svelte`.

**Spec:** `minion_hub/docs/superpowers/specs/2026-05-26-flow-nodes-v2-sp1-design.md`

**Git:** langgraph-server commits go to the **meta-repo** (`/home/nikolas/Documents/CODE/MINION`, branch `dev`). Hub commits go to **`minion_hub/`** (its own repo, branch `dev`). Both repos have many unrelated untracked files — always use `git add <explicit-paths>`, never `git add -A`.

---

## File Structure

**langgraph-server/** (files in the meta-repo at `/home/nikolas/Documents/CODE/MINION/langgraph-server/`)
- Modify: `package.json` — add `ws`, `@langchain/openai`; add dev dep `@types/ws`
- Modify: `src/flow/types.ts` — add `LLMNodeData`; add `sessionMode` to `AgentNodeData`; add `'llm'` to `FlowNode.type`
- Create: `src/flow/provider.ts` — `resolveProviderModel(modelId, env?)` → BaseChatModel (OpenRouter or Anthropic)
- Create: `src/flow/provider.test.ts`
- Create: `src/gateway/client.ts` — singleton WS client; `sendAgentTurn()`; `isConnected()`; `extractReply()` (exported for tests)
- Create: `src/gateway/client.test.ts`
- Modify: `src/flow/compile-flow.ts` — extend `validateFlowShape` + `compileFlow` for `llm`/`agent` node types; add `gatewayClient` to `CompileOptions`
- Modify: `src/flow/compile-flow.test.ts` — add `llm` + `agent` node test cases
- Modify: `src/flow/server.ts` — expand zod schema type enum; import gateway client
- Modify: `.env` — add `GATEWAY_URL`, `GATEWAY_TOKEN`, `OPENROUTER_API_KEY`

**minion_hub/** (at `/home/nikolas/Documents/CODE/MINION/minion_hub/`)
- Modify: `src/lib/state/features/flow-editor.svelte.ts` — add `LLMNodeData` type; add `sessionMode` to `AgentNodeData`; update `FlowNode.type`
- Create: `src/lib/components/flow-editor/nodes/LLMNode.svelte`
- Modify: `src/lib/components/flow-editor/nodes/AgentNode.svelte` — replace MODEL_OPTIONS with `gw.agents`; add sessionMode toggle
- Modify: `src/lib/components/flow-editor/FlowSidebar.svelte` — add LLM palette item
- Modify: `src/lib/components/flow-editor/FlowCanvas.svelte` — add `llm` node type + drop branch

---

## Task 1: Add langgraph-server deps

**Files:**
- Modify: `langgraph-server/package.json`

- [ ] **Step 1: Install new deps**

```bash
cd /home/nikolas/Documents/CODE/MINION/langgraph-server
npm install ws @langchain/openai
npm install -D @types/ws
```
Expected: installs succeed. **Verify `@langchain/langgraph` stays at `1.3.1`:**
```bash
node -e "console.log(require('./node_modules/@langchain/langgraph/package.json').version)"
```
Expected: `1.3.1`.

- [ ] **Step 2: Verify tsc still clean**

```bash
cd /home/nikolas/Documents/CODE/MINION/langgraph-server && npx tsc --noEmit
```
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
cd /home/nikolas/Documents/CODE/MINION
git add langgraph-server/package.json langgraph-server/package-lock.json
git commit -m "chore(langgraph-server): add ws + @langchain/openai for gateway client + OpenRouter

Co-Authored-By: Claude Sonnet 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Update flow types (langgraph-server)

**Files:**
- Modify: `langgraph-server/src/flow/types.ts`

- [ ] **Step 1: Read the current file**

```bash
cat /home/nikolas/Documents/CODE/MINION/langgraph-server/src/flow/types.ts
```

- [ ] **Step 2: Add `LLMNodeData`, update `AgentNodeData` + `FlowNode`**

In `src/flow/types.ts`, apply these changes:

Add `LLMNodeData` after `PromptBoxData`:
```ts
export type LLMNodeData = {
  modelId: string;  // e.g. 'anthropic/claude-haiku-4-5', 'openai/gpt-4o'
  label: string;
};
```

Add `sessionMode` to `AgentNodeData` (after `label`):
```ts
  sessionMode: 'ephemeral' | 'shared';
```
(Keep all other existing fields: `defaultValues?`, `contextRules?`, `inputHandles?`, `outputHandles?`, `contextHandles?`)

Update `FlowNode`:
```ts
export type FlowNode = {
  id: string;
  type: 'agent' | 'promptBox' | 'llm';   // add 'llm'
  position: { x: number; y: number };
  data: AgentNodeData | PromptBoxData | LLMNodeData;  // add LLMNodeData
};
```

- [ ] **Step 3: tsc check**

```bash
cd /home/nikolas/Documents/CODE/MINION/langgraph-server && npx tsc --noEmit
```
Expected: PASS (compile-flow.ts may flag that `nodes.find(n => n.type === 'agent')` now narrows incorrectly — that's fine, we'll fix it in Task 5).

- [ ] **Step 4: Commit**

```bash
cd /home/nikolas/Documents/CODE/MINION
git add langgraph-server/src/flow/types.ts
git commit -m "feat(langgraph-server): add LLMNodeData type + sessionMode to AgentNodeData

Co-Authored-By: Claude Sonnet 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Provider factory `src/flow/provider.ts` (TDD)

**Files:**
- Create: `langgraph-server/src/flow/provider.ts`
- Create: `langgraph-server/src/flow/provider.test.ts`

- [ ] **Step 1: Write the failing test**

Create `langgraph-server/src/flow/provider.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { ChatOpenAI } from '@langchain/openai';
import { ChatAnthropic } from '@langchain/anthropic';
import { resolveProviderModel } from './provider.js';

describe('resolveProviderModel', () => {
  it('returns ChatOpenAI pointed at OpenRouter when OPENROUTER_API_KEY is set', () => {
    const model = resolveProviderModel('openai/gpt-4o', { OPENROUTER_API_KEY: 'sk-or-test' });
    expect(model).toBeInstanceOf(ChatOpenAI);
  });

  it('returns ChatAnthropic when only ANTHROPIC_API_KEY is set', () => {
    const model = resolveProviderModel('claude-haiku-4-5-20251001', { ANTHROPIC_API_KEY: 'sk-ant-test' });
    expect(model).toBeInstanceOf(ChatAnthropic);
  });

  it('prefers OpenRouter over Anthropic when both keys are set', () => {
    const model = resolveProviderModel('some-model', {
      OPENROUTER_API_KEY: 'sk-or-test',
      ANTHROPIC_API_KEY: 'sk-ant-test',
    });
    expect(model).toBeInstanceOf(ChatOpenAI);
  });

  it('throws when neither key is set', () => {
    expect(() => resolveProviderModel('some-model', {})).toThrow(
      'No LLM provider configured',
    );
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
cd /home/nikolas/Documents/CODE/MINION/langgraph-server && npx vitest run src/flow/provider.test.ts
```
Expected: FAIL — `provider.js` not found.

- [ ] **Step 3: Implement `provider.ts`**

Create `langgraph-server/src/flow/provider.ts`:
```ts
import { ChatOpenAI } from '@langchain/openai';
import { ChatAnthropic } from '@langchain/anthropic';

export function resolveProviderModel(
  modelId: string,
  env: Record<string, string | undefined> = process.env,
) {
  if (env.OPENROUTER_API_KEY) {
    return new ChatOpenAI({
      apiKey: env.OPENROUTER_API_KEY,
      model: modelId,
      temperature: 0,
      configuration: { baseURL: 'https://openrouter.ai/api/v1' },
    });
  }
  if (env.ANTHROPIC_API_KEY) {
    return new ChatAnthropic({ model: modelId, temperature: 0 });
  }
  throw new Error(
    'No LLM provider configured — set OPENROUTER_API_KEY or ANTHROPIC_API_KEY.',
  );
}
```

- [ ] **Step 4: Run to verify it passes**

```bash
cd /home/nikolas/Documents/CODE/MINION/langgraph-server && npx vitest run src/flow/provider.test.ts
```
Expected: PASS (4 tests). Also run `npx tsc --noEmit` → PASS.

- [ ] **Step 5: Commit**

```bash
cd /home/nikolas/Documents/CODE/MINION
git add langgraph-server/src/flow/provider.ts langgraph-server/src/flow/provider.test.ts
git commit -m "feat(langgraph-server): provider factory — OpenRouter default, Anthropic fallback

Co-Authored-By: Claude Sonnet 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Gateway WS client `src/gateway/client.ts` (TDD)

**Files:**
- Create: `langgraph-server/src/gateway/client.ts`
- Create: `langgraph-server/src/gateway/client.test.ts`

⚠️ **Spec flag:** The exact response shape of `chat.send` must be verified against `minion_hub/src/lib/services/gateway.svelte.ts` (search for `sendVoiceTurn`) before this task ships. The client's `extractReply` handles several common shapes defensively; narrow it to the actual shape after verification.

- [ ] **Step 1: Write tests for `extractReply` + session-key logic**

Create `langgraph-server/src/gateway/client.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { extractReply, deriveSessionKey } from './client.js';

describe('extractReply', () => {
  it('extracts a top-level string content field', () => {
    expect(extractReply({ content: 'hello' })).toBe('hello');
  });
  it('extracts a top-level reply field', () => {
    expect(extractReply({ reply: 'hi there' })).toBe('hi there');
  });
  it('extracts the last message from a messages array', () => {
    expect(extractReply({ messages: [{ content: 'first' }, { content: 'last' }] })).toBe('last');
  });
  it('returns null for unrecognised shape', () => {
    expect(extractReply({ foo: 'bar' })).toBeNull();
  });
  it('returns null for null input', () => {
    expect(extractReply(null)).toBeNull();
  });
});

describe('deriveSessionKey', () => {
  it('makes an ephemeral key from runId + nodeId', () => {
    expect(deriveSessionKey('ephemeral', 'agent1', 'run-123', 'node-abc')).toBe(
      'flow-run:run-123:node-abc',
    );
  });
  it('makes a shared key from agentId', () => {
    expect(deriveSessionKey('shared', 'PANIK', 'any', 'any')).toBe('agent:PANIK:main');
  });
});
```

- [ ] **Step 2: Run to verify tests fail**

```bash
cd /home/nikolas/Documents/CODE/MINION/langgraph-server && npx vitest run src/gateway/client.test.ts
```
Expected: FAIL — module not found.

- [ ] **Step 3: Create `src/gateway/client.ts`**

Create `langgraph-server/src/gateway/client.ts`:
```ts
import WebSocket from 'ws';
import { randomUUID } from 'node:crypto';

// ── Frame protocol (mirrors @minion-stack/shared gateway frame types) ──────────

type RequestFrame = { id: string; type: 'req'; method: string; params?: unknown };
type ResponseFrame = { id: string; type: 'res'; result?: unknown; error?: string };
type EventFrame = { type: 'event'; event: string; payload?: unknown };
type Frame = RequestFrame | ResponseFrame | EventFrame;

// ── Singleton WS connection ────────────────────────────────────────────────────

const GATEWAY_URL = process.env.GATEWAY_URL ?? '';
const GATEWAY_TOKEN = process.env.GATEWAY_TOKEN ?? '';

let ws: WebSocket | null = null;
let reconnectDelay = 1_000;
const pending = new Map<
  string,
  { resolve: (v: unknown) => void; reject: (e: Error) => void }
>();

function connect() {
  if (!GATEWAY_URL) return;
  ws = new WebSocket(GATEWAY_URL);

  ws.on('message', (raw) => {
    let frame: Frame;
    try { frame = JSON.parse(raw.toString()) as Frame; } catch { return; }

    if (frame.type === 'event' && frame.event === 'connect.challenge') {
      const challenge = (frame.payload as { challenge: string }).challenge;
      const id = randomUUID();
      ws!.send(JSON.stringify({
        id, type: 'req', method: 'connect',
        params: { token: GATEWAY_TOKEN, challenge },
      } satisfies RequestFrame));
      return;
    }

    if (frame.type === 'res') {
      const p = pending.get(frame.id);
      if (!p) return;
      pending.delete(frame.id);
      if (frame.error) p.reject(new Error(frame.error));
      else p.resolve(frame.result);
    }
  });

  ws.on('open', () => { reconnectDelay = 1_000; });

  ws.on('close', () => {
    ws = null;
    reconnectDelay = Math.min(reconnectDelay * 2, 30_000);
    if (GATEWAY_URL) setTimeout(connect, reconnectDelay);
  });

  ws.on('error', () => { /* 'close' fires after 'error' */ });
}

if (GATEWAY_URL) connect();

// ── Public helpers ─────────────────────────────────────────────────────────────

export function isConnected(): boolean {
  return ws !== null && ws.readyState === WebSocket.OPEN;
}

export async function request(method: string, params?: unknown): Promise<unknown> {
  if (!isConnected()) {
    throw new Error(
      `Gateway not connected — check GATEWAY_URL (${GATEWAY_URL || 'not set'}) and GATEWAY_TOKEN.`,
    );
  }
  return new Promise((resolve, reject) => {
    const id = randomUUID();
    pending.set(id, { resolve, reject });
    ws!.send(JSON.stringify({ id, type: 'req', method, params } satisfies RequestFrame));
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        reject(new Error(`Gateway RPC timed out after 30s: ${method}`));
      }
    }, 30_000);
  });
}

// Exported for tests.
export function extractReply(result: unknown): string | null {
  if (typeof result === 'string') return result;
  if (!result || typeof result !== 'object') return null;
  const r = result as Record<string, unknown>;
  // Try common gateway response shapes.
  // IMPORTANT: narrow this to the actual shape after verifying sendVoiceTurn
  // in minion_hub/src/lib/services/gateway.svelte.ts.
  if (typeof r.content === 'string') return r.content;
  if (typeof r.reply === 'string') return r.reply;
  if (typeof r.message === 'string') return r.message;
  if (typeof r.text === 'string') return r.text;
  if (Array.isArray(r.messages)) {
    const last = r.messages[r.messages.length - 1] as { content?: unknown } | null;
    if (last && typeof last.content === 'string') return last.content;
  }
  return null;
}

// Exported for tests.
export function deriveSessionKey(
  sessionMode: 'ephemeral' | 'shared',
  agentId: string,
  runId: string,
  nodeId: string,
): string {
  return sessionMode === 'ephemeral'
    ? `flow-run:${runId}:${nodeId}`
    : `agent:${agentId}:main`;
}

export async function sendAgentTurn(
  agentId: string,
  prompt: string,
  sessionMode: 'ephemeral' | 'shared',
  runId: string,
  nodeId: string,
): Promise<string> {
  const sessionKey = deriveSessionKey(sessionMode, agentId, runId, nodeId);

  const result = await request('chat.send', {
    agentId,
    message: prompt,
    sessionKey,
    deliver: false,
    idempotencyKey: runId,
  });

  const reply = extractReply(result);
  if (reply === null) {
    throw new Error(
      `Agent "${agentId}" returned no recognisable reply. Raw: ${JSON.stringify(result)}`,
    );
  }
  return reply;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd /home/nikolas/Documents/CODE/MINION/langgraph-server && npx vitest run src/gateway/client.test.ts
```
Expected: PASS (7 tests). Also run `npx tsc --noEmit` → PASS.

- [ ] **Step 5: Commit**

```bash
cd /home/nikolas/Documents/CODE/MINION
git add langgraph-server/src/gateway/client.ts langgraph-server/src/gateway/client.test.ts
git commit -m "feat(langgraph-server): gateway WS client with sendAgentTurn + ephemeral/shared sessions

Co-Authored-By: Claude Sonnet 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Extend `compileFlow` for `llm` + `agent` node types (TDD)

**Files:**
- Modify: `langgraph-server/src/flow/compile-flow.ts`
- Modify: `langgraph-server/src/flow/compile-flow.test.ts`

- [ ] **Step 1: Add failing tests for new node shapes**

Read the current `compile-flow.test.ts` to understand existing imports and fixtures, then **append** these new describe blocks at the end of the file. Do NOT remove existing tests.

First, extend the existing imports line at the top of the test file to also import `LLMNodeData`:
```ts
import { validateFlowShape, compileFlow, resolveModelId, DEFAULT_MODEL } from './compile-flow.js';
import { UnsupportedFlowError, type FlowNode, type FlowEdge, type LLMNodeData } from './types.js';
import { AIMessage, HumanMessage, type BaseMessage } from '@langchain/core/messages';
```

Append new tests (keep all existing tests intact):
```ts
// ── New node types ────────────────────────────────────────────────────────────

const llmNode: FlowNode = {
  id: 'l1', type: 'llm', position: { x: 200, y: 0 },
  data: { modelId: 'openai/gpt-4o', label: 'LLM' } satisfies LLMNodeData,
};
const edgeToLlm: FlowEdge = {
  id: 'e-llm', source: 'p1', sourceHandle: 'prompt-out',
  target: 'l1', targetHandle: 'in', type: 'flow',
};

describe('validateFlowShape — llm nodes', () => {
  it('accepts one prompt connected to one llm node', () => {
    expect(() => validateFlowShape([prompt, llmNode], [edgeToLlm])).not.toThrow();
  });

  it('rejects two execution nodes (agent + llm)', () => {
    expect(() => validateFlowShape([prompt, agent, llmNode], [edge, edgeToLlm])).toThrow(
      UnsupportedFlowError,
    );
  });
});

describe('compileFlow — llm node', () => {
  it('uses the modelId from LLMNodeData and calls the injected model', async () => {
    const fakeModel = {
      async invoke(messages: BaseMessage[]) {
        const last = messages[messages.length - 1];
        return new AIMessage(`llm-echo:${String(last.content)}`);
      },
    };
    const { graph, initialState } = compileFlow([prompt, llmNode], [edgeToLlm], {
      model: fakeModel,
    });
    expect(initialState.messages[0]).toBeInstanceOf(HumanMessage);
    const result = await graph.invoke(initialState);
    expect(result.messages[result.messages.length - 1].content).toBe('llm-echo:Hello');
  });
});

describe('compileFlow — agent node (real gateway agent)', () => {
  it('calls gatewayClient.sendAgentTurn with correct args and returns reply', async () => {
    const calls: Array<{ agentId: string; prompt: string; sessionMode: string }> = [];
    const fakeGateway = {
      async sendAgentTurn(agentId: string, prompt: string, sessionMode: 'ephemeral' | 'shared') {
        calls.push({ agentId, prompt, sessionMode });
        return 'gateway-reply';
      },
    };
    const agentNodeGw: FlowNode = {
      id: 'a1', type: 'agent', position: { x: 200, y: 0 },
      data: {
        agentId: 'PANIK',
        label: 'PANIK',
        sessionMode: 'ephemeral',
        inputHandles: [{ id: 'in', label: 'input' }],
        outputHandles: [{ id: 'out', label: 'output' }],
        contextHandles: [{ id: 'ctx', label: 'context' }],
      },
    };
    const edgeGw: FlowEdge = {
      id: 'eg', source: 'p1', sourceHandle: 'prompt-out',
      target: 'a1', targetHandle: 'in', type: 'flow',
    };
    const { graph, initialState } = compileFlow([prompt, agentNodeGw], [edgeGw], {
      gatewayClient: fakeGateway,
    });
    const result = await graph.invoke(initialState);
    expect(calls).toHaveLength(1);
    expect(calls[0].agentId).toBe('PANIK');
    expect(calls[0].prompt).toBe('Hello');
    expect(calls[0].sessionMode).toBe('ephemeral');
    expect(result.messages[result.messages.length - 1].content).toBe('gateway-reply');
  });
});
```

- [ ] **Step 2: Run to verify new tests fail**

```bash
cd /home/nikolas/Documents/CODE/MINION/langgraph-server && npx vitest run src/flow/compile-flow.test.ts 2>&1 | tail -15
```
Expected: existing 9 tests pass; new ~5 tests FAIL.

- [ ] **Step 3: Rewrite `compile-flow.ts`**

Read the current `compile-flow.ts` (`cat /home/nikolas/Documents/CODE/MINION/langgraph-server/src/flow/compile-flow.ts`), then replace its content with:

```ts
import { ChatAnthropic } from '@langchain/anthropic';
import { MessagesAnnotation, StateGraph } from '@langchain/langgraph';
import { HumanMessage, AIMessage, type BaseMessage } from '@langchain/core/messages';
import { randomUUID } from 'node:crypto';
import {
  UnsupportedFlowError,
  type FlowNode,
  type FlowEdge,
  type AgentNodeData,
  type PromptBoxData,
  type LLMNodeData,
} from './types.js';
import { resolveProviderModel } from './provider.js';
import { sendAgentTurn } from '../gateway/client.js';

const MVP_HINT = 'MVP runner supports exactly one Prompt connected to one Agent or LLM node.';

export const DEFAULT_MODEL = 'claude-haiku-4-5-20251001';

export function validateFlowShape(nodes: FlowNode[], edges: FlowEdge[]): void {
  const prompts = nodes.filter((n) => n.type === 'promptBox');
  const execNodes = nodes.filter((n) => n.type === 'agent' || n.type === 'llm');

  if (prompts.length !== 1) {
    throw new UnsupportedFlowError(
      `Expected exactly 1 prompt node, found ${prompts.length}. ${MVP_HINT}`,
    );
  }
  if (execNodes.length !== 1) {
    throw new UnsupportedFlowError(
      `Expected exactly 1 agent or LLM node, found ${execNodes.length}. ${MVP_HINT}`,
    );
  }

  const prompt = prompts[0];
  const exec = execNodes[0];
  const connected = edges.some(
    (e) => e.source === prompt.id && e.target === exec.id && e.type === 'flow',
  );
  if (!connected) {
    throw new UnsupportedFlowError(`Prompt must be connected to the agent or LLM. ${MVP_HINT}`);
  }
}

/**
 * MVP contract: a legacy 'agent' node whose agentId starts with "claude-" is
 * treated as an LLM node (backward compat for MVP flows).
 */
export function resolveModelId(agentId: string): string {
  return (agentId ?? '').startsWith('claude-') ? agentId : DEFAULT_MODEL;
}

interface ChatModel {
  invoke(messages: BaseMessage[]): Promise<BaseMessage>;
}

interface GatewayClient {
  sendAgentTurn(
    agentId: string,
    prompt: string,
    sessionMode: 'ephemeral' | 'shared',
    runId: string,
    nodeId: string,
  ): Promise<string>;
}

export interface CompileOptions {
  /** Inject a model for tests (llm node path). Defaults to resolveProviderModel(). */
  model?: ChatModel;
  /** Inject a gateway client for tests (agent node path). Defaults to the real client. */
  gatewayClient?: GatewayClient;
}

export function compileFlow(
  nodes: FlowNode[],
  edges: FlowEdge[],
  opts: CompileOptions = {},
) {
  validateFlowShape(nodes, edges);

  const promptNode = nodes.find((n) => n.type === 'promptBox')!;
  const execNode = nodes.find((n) => n.type === 'agent' || n.type === 'llm')!;
  const promptValue = (promptNode.data as PromptBoxData).value ?? '';
  const runId = randomUUID();

  const callNode = buildExecNode(execNode, opts, runId);

  const graph = new StateGraph(MessagesAnnotation)
    .addNode('exec', callNode)
    .addEdge('__start__', 'exec')
    .addEdge('exec', '__end__')
    .compile();

  const initialState = { messages: [new HumanMessage(promptValue)] };
  return { graph, initialState };
}

function buildExecNode(
  node: FlowNode,
  opts: CompileOptions,
  runId: string,
): (state: typeof MessagesAnnotation.State) => Promise<{ messages: BaseMessage[] }> {
  // llm node — direct model call
  if (node.type === 'llm') {
    const { modelId } = node.data as LLMNodeData;
    const model: ChatModel = opts.model ?? resolveProviderModel(modelId);
    return async (state) => {
      const response = await model.invoke(state.messages);
      return { messages: [response] };
    };
  }

  // agent node — check for legacy claude-* id (backward compat)
  const agentData = node.data as AgentNodeData;
  const isLegacyLLM = agentData.agentId?.startsWith('claude-');

  if (isLegacyLLM) {
    const modelId = resolveModelId(agentData.agentId);
    const model: ChatModel = opts.model ?? resolveProviderModel(modelId);
    return async (state) => {
      const response = await model.invoke(state.messages);
      return { messages: [response] };
    };
  }

  // agent node — real gateway agent
  const gc: GatewayClient = opts.gatewayClient ?? { sendAgentTurn };
  return async (state) => {
    const lastHuman = [...state.messages].reverse().find((m) => m._getType() === 'human');
    const prompt = String(lastHuman?.content ?? '');
    const reply = await gc.sendAgentTurn(
      agentData.agentId,
      prompt,
      agentData.sessionMode ?? 'ephemeral',
      runId,
      node.id,
    );
    return { messages: [new AIMessage(reply)] };
  };
}
```

- [ ] **Step 4: Run all tests to verify they pass**

```bash
cd /home/nikolas/Documents/CODE/MINION/langgraph-server && npx vitest run src/flow/compile-flow.test.ts
```
Expected: all tests PASS (existing 9 + new ~5 = 14 total). Also run `npx tsc --noEmit` → PASS.

- [ ] **Step 5: Commit**

```bash
cd /home/nikolas/Documents/CODE/MINION
git add langgraph-server/src/flow/compile-flow.ts langgraph-server/src/flow/compile-flow.test.ts
git commit -m "feat(langgraph-server): extend compileFlow for llm + real-agent node types

Co-Authored-By: Claude Sonnet 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Update `server.ts` zod schema + `.env`

**Files:**
- Modify: `langgraph-server/src/flow/server.ts`
- Modify: `langgraph-server/.env`

- [ ] **Step 1: Read server.ts**

```bash
cat /home/nikolas/Documents/CODE/MINION/langgraph-server/src/flow/server.ts
```

- [ ] **Step 2: Update zod enum in `FlowRunRequest`**

Find this line in `server.ts`:
```ts
      type: z.enum(['agent', 'promptBox']),
```
Change it to:
```ts
      type: z.enum(['agent', 'promptBox', 'llm']),
```

Also update the edges schema `type` enum to keep it complete (it already has `flow`/`context`, no change needed there).

- [ ] **Step 3: Add new env vars to `.env`**

Append to `langgraph-server/.env`:
```
# Gateway WS connection (for agent node routing)
GATEWAY_URL=ws://localhost:8765
GATEWAY_TOKEN=

# LLM provider — OpenRouter recommended (routes any model string)
OPENROUTER_API_KEY=
# ANTHROPIC_API_KEY is already set above (MVP)
```

- [ ] **Step 4: tsc check + run full suite**

```bash
cd /home/nikolas/Documents/CODE/MINION/langgraph-server
npx tsc --noEmit
npm run test
```
Expected: tsc PASS; all tests PASS.

- [ ] **Step 5: Smoke test with the new `llm` node type**

Start the server (`npm run flows`) in one terminal, then in another:
```bash
curl -sN -X POST http://localhost:2025/flows/run \
  -H 'Content-Type: application/json' \
  -d '{"nodes":[{"id":"p1","type":"promptBox","position":{"x":0,"y":0},"data":{"label":"Prompt","value":"Say hi in 2 words"}},{"id":"l1","type":"llm","position":{"x":200,"y":0},"data":{"modelId":"claude-haiku-4-5-20251001","label":"LLM"}}],"edges":[{"id":"e1","source":"p1","sourceHandle":"prompt-out","target":"l1","targetHandle":"in","type":"flow"}]}'
```
Expected: SSE stream with `info: "Starting flow run…"` → `info: <model reply>` → `info: "Flow run complete."` → `event: done`. Kill the server when done.

- [ ] **Step 6: Commit**

```bash
cd /home/nikolas/Documents/CODE/MINION
git add langgraph-server/src/flow/server.ts langgraph-server/.env
git commit -m "feat(langgraph-server): expand zod schema for llm node type; add gateway + openrouter env vars

Co-Authored-By: Claude Sonnet 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Update hub types in `flow-editor.svelte.ts`

**Files:**
- Modify: `minion_hub/src/lib/state/features/flow-editor.svelte.ts`

- [ ] **Step 1: Read the current file**

```bash
cat /home/nikolas/Documents/CODE/MINION/minion_hub/src/lib/state/features/flow-editor.svelte.ts
```

- [ ] **Step 2: Add `LLMNodeData` + update `AgentNodeData` + `FlowNode`**

**Add `LLMNodeData`** after the `PromptBoxData` type (around line 20):
```ts
export type LLMNodeData = {
  modelId: string;  // e.g. 'anthropic/claude-haiku-4-5', 'openai/gpt-4o'
  label: string;
};
```

**Update `AgentNodeData`** — add `sessionMode` after the `label` field:
```ts
export type AgentNodeData = {
  agentId: string;
  label: string;
  sessionMode: 'ephemeral' | 'shared';   // NEW
  defaultValues: Record<string, string>;
  contextRules: ContextRule[];
  inputHandles: HandleDef[];
  outputHandles: HandleDef[];
  contextHandles: HandleDef[];
};
```

**Update `FlowNode`**:
```ts
export type FlowNode = {
  id: string;
  type: 'agent' | 'promptBox' | 'llm';    // add 'llm'
  position: { x: number; y: number };
  data: AgentNodeData | PromptBoxData | LLMNodeData;  // add LLMNodeData
};
```

- [ ] **Step 3: Type-check**

```bash
cd /home/nikolas/Documents/CODE/MINION/minion_hub && bun run check 2>&1 | grep -iE 'flow-editor\.svelte|LLMNode|AgentNode' | head -20 || echo "no type errors for these files"
```
Expected: no errors for the changed files (pre-existing unrelated errors elsewhere are fine).

- [ ] **Step 4: Commit**

```bash
cd /home/nikolas/Documents/CODE/MINION/minion_hub
git add src/lib/state/features/flow-editor.svelte.ts
git commit -m "feat(hub): add LLMNodeData type + sessionMode to AgentNodeData

Co-Authored-By: Claude Sonnet 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: Create `LLMNode.svelte`

**Files:**
- Create: `minion_hub/src/lib/components/flow-editor/nodes/LLMNode.svelte`

This is Svelte 5 (runes). Use the Svelte autofixer MCP after writing (`mcp__plugin_svelte_svelte__svelte-autofixer`) to catch any Svelte 5 issues.

`sendRequest` is imported from `'$lib/services/gateway.svelte'`. `setNodes` and `flowEditorState` come from the flow-editor state module.

- [ ] **Step 1: Create the component**

```svelte
<script lang="ts">
  import { Handle, Position } from '@xyflow/svelte';
  import type { NodeProps } from '@xyflow/svelte';
  import type { LLMNodeData } from '$lib/state/features/flow-editor.svelte';
  import { flowEditorState, setNodes } from '$lib/state/features/flow-editor.svelte';
  import { Cpu } from 'lucide-svelte';
  import { onMount } from 'svelte';
  import { sendRequest } from '$lib/services/gateway.svelte';

  let { data, id }: NodeProps & { data: LLMNodeData } = $props();

  interface ModelItem { id: string; name: string }
  let models = $state<ModelItem[]>([]);
  let defaultFallback = $state(false);

  const FALLBACK_MODELS: ModelItem[] = [
    { id: 'claude-haiku-4-5-20251001', name: 'Claude Haiku 4.5' },
    { id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6' },
    { id: 'claude-opus-4-7', name: 'Claude Opus 4.7' },
  ];

  onMount(async () => {
    try {
      const res = await sendRequest('models.list', {}) as {
        models?: ModelItem[];
        defaultModel?: string;
      } | null;
      if (res?.models && res.models.length > 0) {
        models = res.models;
        // If current modelId is empty, default to the gateway's defaultModel
        if (!data.modelId && res.defaultModel) {
          pickModel(res.defaultModel, res.models.find((m) => m.id === res.defaultModel)?.name ?? res.defaultModel);
        }
      } else {
        models = FALLBACK_MODELS;
        defaultFallback = true;
      }
    } catch {
      models = FALLBACK_MODELS;
      defaultFallback = true;
    }
  });

  function pickModel(modelId: string, label: string) {
    const next = flowEditorState.nodes.map((n) =>
      n.id === id ? { ...n, data: { ...n.data, modelId, label } } : n,
    );
    setNodes(next);
  }

  function handleChange(e: Event) {
    const modelId = (e.target as HTMLSelectElement).value;
    const label = models.find((m) => m.id === modelId)?.name ?? modelId;
    pickModel(modelId, label);
  }
</script>

<!-- Output handle only (no input — prompt comes from the promptBox via edge) -->
<Handle
  type="source"
  position={Position.Right}
  id="out"
  class="!w-3 !h-3 !border-2 !border-emerald-400 !bg-emerald-900"
/>

<div
  class="relative bg-bg2 border rounded-xl px-4 py-3 min-w-44 max-w-56 shadow-lg select-none border-border hover:border-border/80"
>
  <div class="flex items-center gap-2 mb-1">
    <div class="w-6 h-6 rounded-md bg-violet-500/20 flex items-center justify-center shrink-0">
      <Cpu size={12} class="text-violet-400" />
    </div>
    <span class="text-xs font-semibold text-foreground truncate">
      {data.label || 'LLM'}
    </span>
  </div>

  {#if defaultFallback}
    <p class="text-[9px] text-amber-400/80 mb-1">Gateway offline — showing defaults</p>
  {/if}

  <select
    class="w-full text-[10px] bg-bg3 border border-border rounded px-1 py-0.5 text-foreground"
    value={data.modelId}
    onclick={(e) => e.stopPropagation()}
    onchange={handleChange}
  >
    {#each models as m (m.id)}
      <option value={m.id}>{m.name ?? m.id}</option>
    {/each}
    {#if data.modelId && !models.some((m) => m.id === data.modelId)}
      <option value={data.modelId}>{data.label || data.modelId}</option>
    {/if}
  </select>
</div>
```

- [ ] **Step 2: Run Svelte autofixer**

Load `mcp__plugin_svelte_svelte__svelte-autofixer` (ToolSearch first), then pass the component's full content. Expected: zero issues.

- [ ] **Step 3: Type-check**

```bash
cd /home/nikolas/Documents/CODE/MINION/minion_hub && bun run check 2>&1 | grep -i 'LLMNode' | head -10 || echo "no LLMNode errors"
```
Expected: no errors for this file.

- [ ] **Step 4: Commit**

```bash
cd /home/nikolas/Documents/CODE/MINION/minion_hub
git add src/lib/components/flow-editor/nodes/LLMNode.svelte
git commit -m "feat(hub): add LLMNode component — model picker backed by gateway models.list

Co-Authored-By: Claude Sonnet 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: Rework `AgentNode.svelte`

**Files:**
- Modify: `minion_hub/src/lib/components/flow-editor/nodes/AgentNode.svelte`

- [ ] **Step 1: Read the current file**

```bash
cat /home/nikolas/Documents/CODE/MINION/minion_hub/src/lib/components/flow-editor/nodes/AgentNode.svelte
```

- [ ] **Step 2: Replace the entire `<script>` section**

Replace everything in the `<script lang="ts">` block with:
```ts
  import { Handle, Position } from '@xyflow/svelte';
  import type { NodeProps } from '@xyflow/svelte';
  import type { AgentNodeData } from '$lib/state/features/flow-editor.svelte';
  import { flowEditorState, setNodes } from '$lib/state/features/flow-editor.svelte';
  import { gw } from '$lib/state/gateway/gateway-data.svelte';
  import { agentDisplayName } from '$lib/utils/agent-display';
  import { Bot } from 'lucide-svelte';
  import * as m from '$lib/paraglide/messages';

  let { data, id, selected }: NodeProps & { data: AgentNodeData } = $props();

  let showSettings = $state(false);
  let hovered = $state(false);
  const showHandles = $derived(flowEditorState.relationshipMode || selected || hovered);

  function isHandleConnected(handleId: string): boolean {
    return flowEditorState.edges.some(
      (e) =>
        (e.source === id && e.sourceHandle === handleId) ||
        (e.target === id && e.targetHandle === handleId),
    );
  }

  function pickAgent(e: Event) {
    const agentId = (e.target as HTMLSelectElement).value;
    const found = gw.agents.find((a) => a.id === agentId);
    const label = found ? agentDisplayName(found) : agentId;
    const next = flowEditorState.nodes.map((n) =>
      n.id === id
        ? { ...n, data: { ...n.data, agentId, label } }
        : n,
    );
    setNodes(next);
  }

  function setSessionMode(mode: 'ephemeral' | 'shared') {
    const next = flowEditorState.nodes.map((n) =>
      n.id === id ? { ...n, data: { ...n.data, sessionMode: mode } } : n,
    );
    setNodes(next);
  }
```

- [ ] **Step 3: Replace the node body `<div>` content**

Find the node body `<div>` (the one with `role="button"`). Inside it, replace the existing agent-display content (the icon + label row and the old `<select>`) with:

```svelte
  <div class="flex items-center gap-2 mb-1">
    <div class="w-6 h-6 rounded-md bg-indigo-500/20 flex items-center justify-center shrink-0">
      <Bot size={12} class="text-indigo-400" />
    </div>
    <span class="text-xs font-semibold text-foreground truncate">{data.label || data.agentId}</span>
  </div>

  <!-- Agent picker -->
  <select
    class="mt-1 w-full text-[10px] bg-bg3 border border-border rounded px-1 py-0.5 text-foreground"
    value={data.agentId}
    onclick={(e) => e.stopPropagation()}
    onchange={pickAgent}
  >
    {#if gw.agents.length === 0}
      <option value={data.agentId} disabled>{data.label || 'No agents connected'}</option>
    {:else}
      {#each gw.agents as agent (agent.id)}
        <option value={agent.id}>{agentDisplayName(agent)}</option>
      {/each}
      {#if data.agentId && !gw.agents.some((a) => a.id === data.agentId)}
        <option value={data.agentId}>{data.label}</option>
      {/if}
    {/if}
  </select>

  <!-- Session mode toggle -->
  <div class="mt-1.5 flex gap-1">
    <button
      class="flex-1 text-[9px] font-semibold rounded px-1 py-0.5 transition-colors
        {(data.sessionMode ?? 'ephemeral') === 'ephemeral'
          ? 'bg-indigo-500/25 text-indigo-300 border border-indigo-500/40'
          : 'text-muted/60 hover:text-muted border border-transparent'}"
      onclick={(e) => { e.stopPropagation(); setSessionMode('ephemeral'); }}
    >
      Ephemeral
    </button>
    <button
      class="flex-1 text-[9px] font-semibold rounded px-1 py-0.5 transition-colors
        {(data.sessionMode ?? 'ephemeral') === 'shared'
          ? 'bg-amber-500/25 text-amber-300 border border-amber-500/40'
          : 'text-muted/60 hover:text-muted border border-transparent'}"
      onclick={(e) => { e.stopPropagation(); setSessionMode('shared'); }}
    >
      Shared
    </button>
  </div>
```

- [ ] **Step 4: Run Svelte autofixer on the updated file**

Pass the full updated `AgentNode.svelte` content to `mcp__plugin_svelte_svelte__svelte-autofixer`. Address any reported issues.

- [ ] **Step 5: Type-check**

```bash
cd /home/nikolas/Documents/CODE/MINION/minion_hub && bun run check 2>&1 | grep -i 'AgentNode' | head -10 || echo "no AgentNode errors"
```

- [ ] **Step 6: Commit**

```bash
cd /home/nikolas/Documents/CODE/MINION/minion_hub
git add src/lib/components/flow-editor/nodes/AgentNode.svelte
git commit -m "feat(hub): rework AgentNode — real gw agent picker + ephemeral/shared session toggle

Co-Authored-By: Claude Sonnet 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task 10: Wire up `FlowSidebar.svelte` + `FlowCanvas.svelte`

**Files:**
- Modify: `minion_hub/src/lib/components/flow-editor/FlowSidebar.svelte`
- Modify: `minion_hub/src/lib/components/flow-editor/FlowCanvas.svelte`

### FlowSidebar.svelte

- [ ] **Step 1: Read the file**

```bash
cat /home/nikolas/Documents/CODE/MINION/minion_hub/src/lib/components/flow-editor/FlowSidebar.svelte
```

- [ ] **Step 2: Add the LLM palette item**

Add `Cpu` to the existing lucide-svelte import:
```ts
  import { Bot, Type, ChevronLeft, ChevronRight, Hammer, Cpu } from 'lucide-svelte';
```

Add a new `addLLMNode()` function alongside the existing `addAgentNode`/`addPromptBox`:
```ts
  function addLLMNode() {
    const node: FlowNode = {
      id: makeId(),
      type: 'llm',
      position: getDropPosition(),
      data: {
        modelId: 'claude-haiku-4-5-20251001',
        label: 'LLM',
      } satisfies LLMNodeData,
    };
    setNodes([...flowEditorState.nodes, node]);
  }
```

Add `LLMNodeData` to the existing type import from `flow-editor.svelte`:
```ts
  import type { FlowNode, AgentNodeData, PromptBoxData, LLMNodeData } from '$lib/state/features/flow-editor.svelte';
```

In the **expanded sidebar** template (the `{:else}` branch under INPUTS section), add the LLM button directly below the existing Prompt Box button:
```svelte
        <button
          onclick={addLLMNode}
          draggable="true"
          ondragstart={(e) => handleDragStart(e, { type: 'llm' })}
          class="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-left hover:bg-bg3 transition-colors border border-transparent hover:border-border/60"
        >
          <div class="w-6 h-6 rounded bg-violet-500/20 flex items-center justify-center shrink-0">
            <Cpu size={12} class="text-violet-400" />
          </div>
          <div>
            <div class="text-xs font-medium text-foreground">LLM</div>
            <div class="text-[10px] text-muted">Direct model call</div>
          </div>
        </button>
```

In the **collapsed sidebar** template (the `{#if collapsed}` branch), add an LLM icon button alongside the existing Prompt Box icon:
```svelte
      <button
        onclick={addLLMNode}
        draggable="true"
        ondragstart={(e) => handleDragStart(e, { type: 'llm' })}
        class="flex items-center justify-center w-7 h-7 rounded-lg hover:bg-bg3 transition-colors border border-transparent hover:border-border/60"
        title="LLM"
      >
        <Cpu size={13} class="text-violet-400" />
      </button>
```

Update the `handleDragStart` payload type union to include `'llm'`:
```ts
  function handleDragStart(e: DragEvent, payload: { type: 'agent' | 'promptBox' | 'llm'; agentId?: string; label?: string }) {
```

### FlowCanvas.svelte

- [ ] **Step 3: Read the canvas file**

```bash
cat /home/nikolas/Documents/CODE/MINION/minion_hub/src/lib/components/flow-editor/FlowCanvas.svelte | head -60
```

- [ ] **Step 4: Update imports + nodeTypes + drop handler**

Add `LLMNode` import at the top alongside `AgentNode` and `PromptBoxNode`:
```ts
  import LLMNode from './nodes/LLMNode.svelte';
```

Add `llm: LLMNode` to the `nodeTypes` map:
```ts
  const nodeTypes: NodeTypes = {
    agent: AgentNode,
    promptBox: PromptBoxNode,
    llm: LLMNode,
  };
```

In `handleDrop`, update the payload type:
```ts
  let payload: { type: 'agent' | 'promptBox' | 'llm'; agentId?: string; label?: string };
```

Add the `llm` branch in `handleDrop` after the existing `agent` branch:
```ts
    } else if (payload.type === 'llm') {
      const node: FlowNode = {
        id: makeId(),
        type: 'llm',
        position,
        data: {
          modelId: 'claude-haiku-4-5-20251001',
          label: 'LLM',
        } satisfies LLMNodeData,
      };
      setNodes([...flowEditorState.nodes, node]);
    }
```

Also add `LLMNodeData` to the import from `flow-editor.svelte` if not already present.

- [ ] **Step 5: Type-check**

```bash
cd /home/nikolas/Documents/CODE/MINION/minion_hub && bun run check 2>&1 | grep -iE 'FlowSidebar|FlowCanvas|LLMNode' | head -20 || echo "no errors in these files"
```

- [ ] **Step 6: Commit**

```bash
cd /home/nikolas/Documents/CODE/MINION/minion_hub
git add src/lib/components/flow-editor/FlowSidebar.svelte src/lib/components/flow-editor/FlowCanvas.svelte
git commit -m "feat(hub): add LLM node to palette + nodeTypes map + drop handler

Co-Authored-By: Claude Sonnet 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task 11: End-to-end verification

- [ ] **Step 1: Run all automated suites**

```bash
cd /home/nikolas/Documents/CODE/MINION/langgraph-server && npm run test
cd /home/nikolas/Documents/CODE/MINION/minion_hub && bun run vitest run src/lib/state/features/flow-run.test.ts
```
Expected: all PASS.

- [ ] **Step 2: Start both servers**

Terminal A:
```bash
cd /home/nikolas/Documents/CODE/MINION/langgraph-server && npm run flows
```
Terminal B:
```bash
cd /home/nikolas/Documents/CODE/MINION/minion_hub && bun run dev
```

- [ ] **Step 3: Verify LLM node happy path**

In a browser, open the hub, go to Flow Editor, create a new flow. Confirm:
- "LLM" appears in the INPUTS palette section (always visible, not gated on gateway).
- Drag/click LLM → an LLM node appears with a model picker (from models.list or fallback).
- Connect Prompt → LLM, type a prompt, click Test Run.
- Console streams `Starting flow run… / Compiled flow to StateGraph. / <model reply> / Flow run complete.`

- [ ] **Step 4: Verify Agent node renders (even without gateway)**

Open an existing flow that has an `agent` node (e.g. the "test" flow). Confirm:
- The agent node shows real agent names in the picker (if gateway is connected) OR "No agents connected" if not.
- The Ephemeral / Shared toggle renders and highlights the active mode when clicked.

- [ ] **Step 5: Verify backward compat**

Open the "PONG demo" flow (seeded in the local DB during previous testing). It has an `agent` node with agentId `claude-haiku-4-5-20251001`. Click Test Run.
Expected: still executes as a direct LLM call (backward-compat legacy path) and streams "PONG".

- [ ] **Step 6: Verify validation error for LLM node + unsupported shape**

Create a flow with 2 LLM nodes (or 1 LLM + 1 Agent), click Test Run.
Expected: console shows `Expected exactly 1 agent or LLM node, found 2. MVP runner supports…`

- [ ] **Step 7: Final commit if any fixes were needed**

```bash
# If any fixes were needed during verification, commit them now.
# If clean, this step is a no-op.
```

---

## Self-Review Notes

**Spec coverage check:**
- ✅ `LLMNodeData` type — Tasks 2, 7
- ✅ `AgentNodeData.sessionMode` — Tasks 2, 7, 9
- ✅ `FlowNode.type` union — Tasks 2, 7, 10
- ✅ Provider factory (OpenRouter default, Anthropic fallback) — Task 3
- ✅ Gateway WS client + `sendAgentTurn` + session-key derivation — Task 4
- ✅ `validateFlowShape` extends to `llm` + `agent` — Task 5
- ✅ `compileFlow` llm path + agent path + legacy backward compat — Task 5
- ✅ zod schema update + env vars — Task 6
- ✅ `LLMNode.svelte` (models.list, fallback, output-only handle) — Task 8
- ✅ `AgentNode.svelte` rework (gw.agents, sessionMode toggle) — Task 9
- ✅ FlowSidebar LLM item — Task 10
- ✅ FlowCanvas `llm` nodeType + drop handler — Task 10
- ✅ Error handling (no provider, no gateway, no agents) — Tasks 3, 4, 5, 8, 9
- ✅ `chat.send` response shape verification note — Task 4 (IMPORTANT flag)

**Known risk:** Task 4's `extractReply` is defensive because the exact `chat.send` response shape is unverified. The implementation must trace `sendVoiceTurn` in `gateway.svelte.ts` and narrow it before shipping. This is the one place to watch.
