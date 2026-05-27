# B3 Tool-calling Agent Node Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `toolAgent` flow node that runs an LLM in a tool-calling ReAct loop (built-in tools + gateway-method tools), bounded by a fixed recursion limit of 10.

**Architecture:** A new runtime node type whose runner builds a tool list (`buildTools`) from the node's `ToolRef[]`, wraps a model in LangGraph's prebuilt `createReactAgent`, invokes it with an optional system prompt prepended to the flow's messages, and appends the agent's final message. Built-in tools (`web_search`, `current_time`, `calculator`) come from a static registry in a new `src/flow/tools.ts`; gateway tools reuse the existing `callGatewayMethod`. The hub gets a `ToolAgentNode.svelte` with model select, system-prompt textarea, and a tool multi-select.

**Tech Stack:** TypeScript, `@langchain/langgraph` 1.3.1 (`createReactAgent` from `/prebuilt`), `@langchain/core/tools` (`tool()`), `@langchain/tavily` (`TavilySearch`), `zod`, vitest (runtime); Svelte 5 runes + `@xyflow/svelte` 1.5.2 (hub).

**Spec:** `minion_hub/docs/superpowers/specs/2026-05-27-flow-tool-agent-node-b3-design.md`

**Branches:** `langgraph-server` = `dev`; `minion_hub` = `dev`. All commits local (do not push). Use named-file `git add` only (never `git add -A`). Do not bump package versions. Always `cd` into the target repo root before `git commit` (symlink quirk).

---

## File Structure

**`langgraph-server` (branch `dev`):**
- Create: `src/flow/tools.ts` — built-in tool registry, `safeEvalArithmetic`, `buildTools`.
- Create: `src/flow/tools.test.ts` — unit tests for the above.
- Modify: `src/flow/types.ts` — add `ToolRef`, `ToolAgentNodeData`, extend `FlowNode` union.
- Modify: `src/flow/compile-flow.ts` — `PROCESSING_TYPES`, `processing` filter, `CompileOptions.reactAgentFactory`, `TOOL_AGENT_RECURSION_LIMIT`, the `toolAgent` runner, imports.
- Modify: `src/flow/compile-flow.test.ts` — toolAgent runner + integration + validation tests.

**`minion_hub` (branch `dev`):**
- Modify: `src/lib/state/features/flow-editor.svelte.ts` — mirror `ToolRef` + `ToolAgentNodeData`, extend `FlowNode` union.
- Create: `src/lib/components/flow-editor/nodes/ToolAgentNode.svelte` — the node component.
- Modify: `src/lib/components/flow-editor/FlowCanvas.svelte` — register `toolAgent` in `nodeTypes`, drop branch.
- Modify: `src/lib/components/flow-editor/FlowSidebar.svelte` — palette item (both views).

---

## Task 1: Runtime types

**Files:**
- Modify: `src/flow/types.ts`

- [ ] **Step 1: Add the tool types and extend the FlowNode union**

In `src/flow/types.ts`, after the `RouterNodeData` block (before `export type FlowNode`), add:

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

Then in `export type FlowNode`, add `'toolAgent'` to the `type` union and `ToolAgentNodeData` to the `data` union:

```ts
export type FlowNode = {
  id: string;
  type: 'agent' | 'promptBox' | 'llm' | 'trigger' | 'pluginTrigger' | 'pluginAction' | 'transform' | 'structured' | 'router' | 'toolAgent';
  position: { x: number; y: number };
  data:
    | AgentNodeData
    | PromptBoxData
    | LLMNodeData
    | TriggerNodeData
    | PluginTriggerNodeData
    | PluginActionNodeData
    | TransformNodeData
    | StructuredNodeData
    | RouterNodeData
    | ToolAgentNodeData;
};
```

- [ ] **Step 2: Type-check**

Run: `cd /home/nikolas/Documents/CODE/MINION/langgraph-server && npx tsc --noEmit`
Expected: PASS (no new errors).

- [ ] **Step 3: Commit**

```bash
cd /home/nikolas/Documents/CODE/MINION/langgraph-server
git add src/flow/types.ts
git commit -m "feat(flow): ToolRef + ToolAgentNodeData types (B3)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Safe arithmetic evaluator

**Files:**
- Create: `src/flow/tools.ts`
- Create: `src/flow/tools.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/flow/tools.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { safeEvalArithmetic } from './tools.js';

describe('safeEvalArithmetic', () => {
  it('evaluates addition and multiplication with precedence', () => {
    expect(safeEvalArithmetic('2+3*4')).toBe(14);
  });
  it('respects parentheses', () => {
    expect(safeEvalArithmetic('(1+2)*3')).toBe(9);
  });
  it('handles decimals and division', () => {
    expect(safeEvalArithmetic('7.5 / 2.5')).toBe(3);
  });
  it('handles unary minus', () => {
    expect(safeEvalArithmetic('-4 + 10')).toBe(6);
  });
  it('rejects identifiers / code', () => {
    expect(() => safeEvalArithmetic('process.exit(1)')).toThrow();
    expect(() => safeEvalArithmetic('a+b')).toThrow();
  });
  it('rejects statement separators', () => {
    expect(() => safeEvalArithmetic('1;2')).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /home/nikolas/Documents/CODE/MINION/langgraph-server && npx vitest run src/flow/tools.test.ts`
Expected: FAIL — cannot resolve `./tools.js` / `safeEvalArithmetic` not exported.

- [ ] **Step 3: Implement the evaluator (no eval/Function)**

Create `src/flow/tools.ts` with the parser. This recursive-descent parser only ever produces numbers from a regex-validated character set — there is no code-execution path:

```ts
/**
 * Evaluate a basic arithmetic expression safely.
 * Only `0-9 . + - * / ( )` and whitespace are permitted (regex-gated), and the
 * value is produced by a recursive-descent parser — never eval/Function/new Function.
 */
export function safeEvalArithmetic(expr: string): number {
  if (typeof expr !== 'string' || !/^[0-9+\-*/().\s]+$/.test(expr)) {
    throw new Error('calculator: only numbers and + - * / ( ) are allowed');
  }
  const tokens = expr.match(/\d+\.?\d*|\.\d+|[+\-*/()]/g);
  if (!tokens) throw new Error('calculator: no tokens');
  let pos = 0;
  const peek = () => tokens[pos];
  const next = () => tokens[pos++];

  // expr := term (('+'|'-') term)*
  function parseExpr(): number {
    let value = parseTerm();
    while (peek() === '+' || peek() === '-') {
      const op = next();
      const rhs = parseTerm();
      value = op === '+' ? value + rhs : value - rhs;
    }
    return value;
  }
  // term := factor (('*'|'/') factor)*
  function parseTerm(): number {
    let value = parseFactor();
    while (peek() === '*' || peek() === '/') {
      const op = next();
      const rhs = parseFactor();
      value = op === '*' ? value * rhs : value / rhs;
    }
    return value;
  }
  // factor := '-' factor | '(' expr ')' | number
  function parseFactor(): number {
    const t = peek();
    if (t === '-') { next(); return -parseFactor(); }
    if (t === '+') { next(); return parseFactor(); }
    if (t === '(') {
      next();
      const value = parseExpr();
      if (next() !== ')') throw new Error('calculator: unbalanced parentheses');
      return value;
    }
    const num = Number(next());
    if (Number.isNaN(num)) throw new Error('calculator: expected a number');
    return num;
  }

  const result = parseExpr();
  if (pos !== tokens.length) throw new Error('calculator: unexpected trailing input');
  return result;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /home/nikolas/Documents/CODE/MINION/langgraph-server && npx vitest run src/flow/tools.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
cd /home/nikolas/Documents/CODE/MINION/langgraph-server
git add src/flow/tools.ts src/flow/tools.test.ts
git commit -m "feat(flow): safe arithmetic evaluator for calculator tool (B3)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Built-in registry + buildTools

**Files:**
- Modify: `src/flow/tools.ts`
- Modify: `src/flow/tools.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `src/flow/tools.test.ts`:

```ts
import { buildTools, BUILTIN_TOOL_IDS } from './tools.js';
import type { FlowRunEvent } from './types.js';

describe('buildTools — built-ins', () => {
  it('exposes the three built-in ids', () => {
    expect(BUILTIN_TOOL_IDS).toEqual(['web_search', 'current_time', 'calculator']);
  });

  it('resolves current_time and calculator with their tool names', () => {
    const tools = buildTools(
      [{ kind: 'builtin', id: 'current_time' }, { kind: 'builtin', id: 'calculator' }],
      { env: {} },
    );
    expect(tools.map((t) => t.name).sort()).toEqual(['calculator', 'current_time']);
  });

  it('calculator tool computes via safeEvalArithmetic', async () => {
    const [calc] = buildTools([{ kind: 'builtin', id: 'calculator' }], { env: {} });
    const out = await calc.invoke({ expression: '6*7' });
    expect(String(out)).toContain('42');
  });

  it('current_time tool returns a parseable ISO string', async () => {
    const [clock] = buildTools([{ kind: 'builtin', id: 'current_time' }], { env: {} });
    const out = await clock.invoke({});
    expect(Number.isNaN(Date.parse(String(out)))).toBe(false);
  });

  it('omits web_search when TAVILY_API_KEY is unset and fires a warn event', () => {
    const events: FlowRunEvent[] = [];
    const tools = buildTools([{ kind: 'builtin', id: 'web_search' }], {
      env: {}, onEvent: (e) => events.push(e),
    });
    expect(tools).toHaveLength(0);
    expect(events[0]?.level).toBe('warn');
  });

  it('includes web_search when TAVILY_API_KEY is set', () => {
    const tools = buildTools([{ kind: 'builtin', id: 'web_search' }], {
      env: { TAVILY_API_KEY: 'test-key' },
    });
    expect(tools).toHaveLength(1);
  });

  it('skips unknown built-in ids', () => {
    const tools = buildTools([{ kind: 'builtin', id: 'does_not_exist' }], { env: {} });
    expect(tools).toHaveLength(0);
  });
});

describe('buildTools — gateway tools', () => {
  it('wraps a gateway ref as a tool that calls the injected invoker', async () => {
    const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
    const [t] = buildTools(
      [{ kind: 'gateway', method: 'weather.get', name: 'get_weather', description: 'Get weather' }],
      {
        env: {},
        runId: 'run-1',
        nodeId: 'node-1',
        gatewayInvoke: async (method, params) => { calls.push({ method, params }); return 'sunny'; },
      },
    );
    expect(t.name).toBe('get_weather');
    const out = await t.invoke({ input: 'Lima' });
    expect(String(out)).toBe('sunny');
    expect(calls[0].method).toBe('weather.get');
    expect(calls[0].params).toMatchObject({ input: 'Lima', runId: 'run-1', nodeId: 'node-1' });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /home/nikolas/Documents/CODE/MINION/langgraph-server && npx vitest run src/flow/tools.test.ts`
Expected: FAIL — `buildTools` / `BUILTIN_TOOL_IDS` not exported.

- [ ] **Step 3: Implement buildTools + registry**

Add to the top of `src/flow/tools.ts` (imports) and below `safeEvalArithmetic`:

```ts
import { tool } from '@langchain/core/tools';
import type { StructuredToolInterface } from '@langchain/core/tools';
import { z } from 'zod';
import { TavilySearch } from '@langchain/tavily';
import { callGatewayMethod } from '../gateway/client.js';
import type { ToolRef, FlowRunEvent } from './types.js';

export const BUILTIN_TOOL_IDS = ['web_search', 'current_time', 'calculator'] as const;

export type GatewayInvoke = (method: string, params: Record<string, unknown>) => Promise<string>;

export interface BuildToolsOptions {
  gatewayInvoke?: GatewayInvoke;
  env?: Record<string, string | undefined>;
  runId?: string;
  nodeId?: string;
  onEvent?: (e: FlowRunEvent) => void;
}

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
        out.push(new TavilySearch({ maxResults: 5, tavilyApiKey: env.TAVILY_API_KEY }) as unknown as StructuredToolInterface);
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

(The `as unknown as StructuredToolInterface` cast on `TavilySearch` bridges the Tavily class to the shared tool interface — mirrors the existing `AnyGraph`/`model as unknown` cast pattern; no `any`.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /home/nikolas/Documents/CODE/MINION/langgraph-server && npx vitest run src/flow/tools.test.ts`
Expected: PASS (all `buildTools` + `safeEvalArithmetic` tests).

- [ ] **Step 5: Type-check**

Run: `cd /home/nikolas/Documents/CODE/MINION/langgraph-server && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
cd /home/nikolas/Documents/CODE/MINION/langgraph-server
git add src/flow/tools.ts src/flow/tools.test.ts
git commit -m "feat(flow): built-in tool registry + buildTools (B3)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: toolAgent runner in compileFlow

**Files:**
- Modify: `src/flow/compile-flow.ts`
- Test: `src/flow/compile-flow.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `src/flow/compile-flow.test.ts` (it already imports `compileFlow`, `BaseMessage`, `AIMessage`, `HumanMessage`, `SystemMessage` from the relevant modules — add `SystemMessage` to the `@langchain/core/messages` import there if absent):

```ts
describe('compileFlow — toolAgent node', () => {
  const prompt = { id: 'p', type: 'promptBox', position: { x: 0, y: 0 }, data: { label: 'P', value: 'hi agent' } } as const;
  const toolAgent = {
    id: 'ta', type: 'toolAgent', position: { x: 1, y: 0 },
    data: { modelId: 'm', systemPrompt: 'You are helpful.', tools: [], label: 'Tool Agent' },
  } as const;
  const edge = { id: 'e', source: 'p', sourceHandle: 'out', target: 'ta', targetHandle: 'in', type: 'flow' } as const;

  it('appends only the agent final message and passes system prompt + recursionLimit', async () => {
    let seenMessages: BaseMessage[] = [];
    let seenConfig: { recursionLimit?: number } | undefined;
    const fakeFactory = (_args: { llm: unknown; tools: unknown[] }) => ({
      async invoke(input: { messages: BaseMessage[] }, config?: { recursionLimit?: number }) {
        seenMessages = input.messages;
        seenConfig = config;
        return { messages: [...input.messages, new AIMessage('AGENT_FINAL')] };
      },
    });

    const { graph, initialState } = compileFlow(
      [prompt, toolAgent] as never,
      [edge] as never,
      { model: { async invoke() { return new AIMessage('x'); } }, reactAgentFactory: fakeFactory },
    );
    const result = await graph.invoke(initialState);
    const last = result.messages[result.messages.length - 1];
    expect(String(last.content)).toBe('AGENT_FINAL');
    // system prompt prepended
    expect(String(seenMessages[0].content)).toBe('You are helpful.');
    // recursion limit fixed at 10
    expect(seenConfig?.recursionLimit).toBe(10);
  });

  it('omits the system message when systemPrompt is empty', async () => {
    let seenMessages: BaseMessage[] = [];
    const fakeFactory = () => ({
      async invoke(input: { messages: BaseMessage[] }) {
        seenMessages = input.messages;
        return { messages: [...input.messages, new AIMessage('OK')] };
      },
    });
    const ta2 = { ...toolAgent, data: { ...toolAgent.data, systemPrompt: '' } };
    const { graph, initialState } = compileFlow(
      [prompt, ta2] as never, [edge] as never,
      { model: { async invoke() { return new AIMessage('x'); } }, reactAgentFactory: fakeFactory },
    );
    await graph.invoke(initialState);
    expect(seenMessages.every((m) => m._getType?.() !== 'system' || String(m.content) !== '')).toBe(true);
    expect(String(seenMessages[0].content)).toBe('hi agent');
  });
});

describe('validateFlowShape — toolAgent', () => {
  it('accepts a prompt → toolAgent flow', () => {
    const prompt = { id: 'p', type: 'promptBox', position: { x: 0, y: 0 }, data: { label: 'P', value: 'x' } };
    const ta = { id: 'ta', type: 'toolAgent', position: { x: 1, y: 0 }, data: { modelId: 'm', tools: [], label: 'T' } };
    const edge = { id: 'e', source: 'p', sourceHandle: 'out', target: 'ta', targetHandle: 'in', type: 'flow' };
    expect(() => validateFlowShape([prompt, ta] as never, [edge] as never)).not.toThrow();
  });

  it('rejects a cycle through a toolAgent', () => {
    const prompt = { id: 'p', type: 'promptBox', position: { x: 0, y: 0 }, data: { label: 'P', value: 'x' } };
    const ta = { id: 'ta', type: 'toolAgent', position: { x: 1, y: 0 }, data: { modelId: 'm', tools: [], label: 'T' } };
    const e1 = { id: 'e1', source: 'p', sourceHandle: 'out', target: 'ta', targetHandle: 'in', type: 'flow' };
    const e2 = { id: 'e2', source: 'ta', sourceHandle: 'out', target: 'ta', targetHandle: 'in', type: 'flow' };
    expect(() => validateFlowShape([prompt, ta] as never, [e1, e2] as never)).toThrow();
  });
});
```

(`validateFlowShape` is already imported in this test file from `./compile-flow.js`.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /home/nikolas/Documents/CODE/MINION/langgraph-server && npx vitest run src/flow/compile-flow.test.ts`
Expected: FAIL — `toolAgent` not in `PROCESSING_TYPES` (validation throws "needs at least one processing node") / no runner (`No runner for node type "toolAgent"`).

- [ ] **Step 3: Wire the runtime**

In `src/flow/compile-flow.ts`:

(a) Add imports near the top:
```ts
import { createReactAgent } from '@langchain/langgraph/prebuilt';
import { buildTools } from './tools.js';
import type { ToolAgentNodeData } from './types.js';
```

(b) Add the recursion-limit constant near `DEFAULT_MODEL`:
```ts
/** Fixed cap on toolAgent ReAct loop super-steps (not user-tunable in B3). */
export const TOOL_AGENT_RECURSION_LIMIT = 10;
```

(c) Add `'toolAgent'` to `PROCESSING_TYPES`:
```ts
const PROCESSING_TYPES = ['llm', 'agent', 'pluginAction', 'transform', 'structured', 'router', 'toolAgent'] as const;
```

(d) Add `toolAgent` to the `processing` filter inside `compileFlow`:
```ts
  const processing = nodes.filter((n) =>
    n.type === 'llm' || n.type === 'agent' || n.type === 'pluginAction' ||
    n.type === 'transform' || n.type === 'structured' || n.type === 'router' ||
    n.type === 'toolAgent',
  );
```

(e) Extend `CompileOptions` with the injectable factory:
```ts
  /** Inject the ReAct agent factory for tests (toolAgent path). Defaults to createReactAgent. */
  reactAgentFactory?: (args: { llm: unknown; tools: unknown[] }) => {
    invoke(
      input: { messages: BaseMessage[] },
      config?: { recursionLimit?: number },
    ): Promise<{ messages: BaseMessage[] }>;
  };
```

(f) Add the runner in `buildNodeRunner`, immediately before the final `throw new UnsupportedFlowError(\`No runner for node type "${node.type}".\`);`:
```ts
  // toolAgent node — ReAct tool-calling loop via createReactAgent
  if (node.type === 'toolAgent') {
    const data = node.data as ToolAgentNodeData;
    const model: ChatModel = opts.model ?? resolveProviderModel(data.modelId ?? DEFAULT_MODEL);
    const factory = opts.reactAgentFactory ?? createReactAgent;
    return async (state) => {
      const tools = buildTools(data.tools ?? [], {
        gatewayInvoke: opts.gatewayClient?.callGatewayMethod,
        runId,
        nodeId: node.id,
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

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /home/nikolas/Documents/CODE/MINION/langgraph-server && npx vitest run src/flow/compile-flow.test.ts`
Expected: PASS (new toolAgent + validation tests, plus all prior tests).

- [ ] **Step 5: Run the full suite + type-check**

Run: `cd /home/nikolas/Documents/CODE/MINION/langgraph-server && npx vitest run && npx tsc --noEmit`
Expected: All tests PASS; tsc clean.

- [ ] **Step 6: Commit**

```bash
cd /home/nikolas/Documents/CODE/MINION/langgraph-server
git add src/flow/compile-flow.ts src/flow/compile-flow.test.ts
git commit -m "feat(flow): toolAgent ReAct runner + conditional wiring (B3)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Hub types mirror

**Files:**
- Modify: `src/lib/state/features/flow-editor.svelte.ts`

- [ ] **Step 1: Mirror the runtime types**

In `minion_hub/src/lib/state/features/flow-editor.svelte.ts`, locate the `RouterNodeData` type and the `FlowNode` union (mirrors of the runtime). After `RouterNodeData`, add:

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

Then extend the `FlowNode` union's `type` field with `| 'toolAgent'` and its `data` field with `| ToolAgentNodeData` (match the exact shape already used in this file for the other node types).

- [ ] **Step 2: Type-check**

Run: `cd /home/nikolas/Documents/CODE/MINION/minion_hub && bun run check 2>&1 | tail -20`
Expected: No NEW errors referencing `flow-editor.svelte.ts` (pre-existing unrelated errors may remain — compare against the known baseline).

- [ ] **Step 3: Commit**

```bash
cd /home/nikolas/Documents/CODE/MINION/minion_hub
git add src/lib/state/features/flow-editor.svelte.ts
git commit -m "feat(flow): mirror ToolRef + ToolAgentNodeData types (B3)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: ToolAgentNode component

**Files:**
- Create: `src/lib/components/flow-editor/nodes/ToolAgentNode.svelte`

First read an existing node for the exact conventions to copy (handles, accent classes, `models.list` fetch, `setNodes` patch pattern, icon import):
- `src/lib/components/flow-editor/nodes/StructuredNode.svelte` (model select + patch pattern)
- `src/lib/components/flow-editor/nodes/RouterNode.svelte` (dynamic list editor + mode toggle)
- `src/lib/components/flow-editor/nodes/AgentNode.svelte` (gateway/plugin pickers, if a plugin-action method picker exists there or in PluginActionNode)
- `src/lib/components/flow-editor/nodes/PluginActionNode.svelte` (the plugin-action method picker to reuse for gateway tools)

- [ ] **Step 1: Build the component**

Create `src/lib/components/flow-editor/nodes/ToolAgentNode.svelte` following the **exact** prop/store/handle conventions of `StructuredNode.svelte` and `RouterNode.svelte` in this repo. It must:

- Use Svelte 5 runes (`$props`, `$state`, `$derived`) — no legacy syntax.
- Render an input `<Handle type="target" position={Position.Left} id="in">` and a single output `<Handle type="source" position={Position.Right} id="out">` (match the ids used by the other append nodes — verify against `StructuredNode.svelte`).
- **Model select:** reuse the `sendRequest('models.list', {})` + fallback pattern from `StructuredNode.svelte`; bind to `data.modelId` via the repo's `setNodes`/`patch` update pattern.
- **System prompt:** a `<textarea>` bound to `data.systemPrompt`, updating via the same patch pattern.
- **Built-in tools:** three checkboxes labeled "Web search", "Current time", "Calculator" mapping to ids `web_search` / `current_time` / `calculator`. Checked = a `{ kind: 'builtin', id }` entry exists in `data.tools`. Toggling adds/removes that entry (compare by `kind === 'builtin' && id ===`).
- **Gateway tools:** reuse the plugin-action method picker pattern from `PluginActionNode.svelte`/`AgentNode.svelte`. On selecting a method, append `{ kind: 'gateway', method, name, description }` where `name` defaults to the method's last dotted segment (e.g. `weather.get` → `get`) and `description` from the contribution metadata if available, else the method string. Render the selected gateway tools as a removable list (× button removes by `method`).
- Accent: violet/indigo (e.g. the repo's `border-violet-*` / `bg-violet-*` utility classes — match how RouterNode picks its amber accent). Icon: `Wrench` from `lucide-svelte` (or `Bot` if `Wrench` is unavailable — verify the import resolves).

**Validate the component with the Svelte MCP autofixer** (`mcp__plugin_svelte_svelte__svelte-autofixer`) and fix everything it reports before committing.

- [ ] **Step 2: Type-check**

Run: `cd /home/nikolas/Documents/CODE/MINION/minion_hub && bun run check 2>&1 | tail -20`
Expected: No new errors referencing `ToolAgentNode.svelte`.

- [ ] **Step 3: Commit**

```bash
cd /home/nikolas/Documents/CODE/MINION/minion_hub
git add src/lib/components/flow-editor/nodes/ToolAgentNode.svelte
git commit -m "feat(flow): ToolAgentNode component (B3)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Register + palette + drop

**Files:**
- Modify: `src/lib/components/flow-editor/FlowCanvas.svelte`
- Modify: `src/lib/components/flow-editor/FlowSidebar.svelte`

- [ ] **Step 1: Register the node type**

In `FlowCanvas.svelte`, import `ToolAgentNode` and add `toolAgent: ToolAgentNode` to the `nodeTypes` object (match how `router: RouterNode` was registered).

- [ ] **Step 2: Add the drop branch**

In `FlowCanvas.svelte` `handleDrop` (or wherever the drop switch builds default node data — match the `router` case), add a `toolAgent` case producing:
```ts
{ modelId: '', systemPrompt: '', tools: [], label: 'Tool Agent' }
```
Widen the drop payload `type` union to include `'toolAgent'`.

- [ ] **Step 3: Add the palette item**

In `FlowSidebar.svelte`, add a "Tool Agent" palette item in **both** views (match exactly how the "Router" palette item was added — same draggable wrapper, same `type` attribute `toolAgent`, a `Wrench` icon). 

- [ ] **Step 4: Type-check**

Run: `cd /home/nikolas/Documents/CODE/MINION/minion_hub && bun run check 2>&1 | tail -20`
Expected: No new errors in `FlowCanvas.svelte` / `FlowSidebar.svelte`.

- [ ] **Step 5: Validate both touched Svelte files with the autofixer**

Run the Svelte MCP autofixer on `FlowCanvas.svelte` and `FlowSidebar.svelte`; fix anything reported.

- [ ] **Step 6: Commit**

```bash
cd /home/nikolas/Documents/CODE/MINION/minion_hub
git add src/lib/components/flow-editor/FlowCanvas.svelte src/lib/components/flow-editor/FlowSidebar.svelte
git commit -m "feat(flow): register + palette + drop for toolAgent node (B3)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: Final verification

**Files:** none (verification only)

- [ ] **Step 1: Full runtime suite + type-check**

Run: `cd /home/nikolas/Documents/CODE/MINION/langgraph-server && npx vitest run && npx tsc --noEmit`
Expected: All tests PASS (prior 52 + the new toolAgent/tools tests), tsc clean.

- [ ] **Step 2: Hub check**

Run: `cd /home/nikolas/Documents/CODE/MINION/minion_hub && bun run check 2>&1 | tail -25`
Expected: No new errors attributable to B3 files (compare to the pre-existing baseline).

- [ ] **Step 3: ReDoS/eval sanity (calculator)**

Run: `cd /home/nikolas/Documents/CODE/MINION/langgraph-server && node -e "const {safeEvalArithmetic}=require('./dist/flow/tools.js'); try{safeEvalArithmetic('process');console.log('FAIL: accepted')}catch{console.log('OK: rejected identifiers')}"` (if no build output exists, instead rely on the vitest cases from Task 2 — they already cover this).
Expected: "OK: rejected identifiers" (or the Task 2 tests already green).

- [ ] **Step 4: Report** the final commit SHAs across both repos and the test counts.

---

## Self-Review Notes (author)

- **Spec coverage:** types (T1/T5), safe calculator (T2), built-in registry + buildTools + gateway wrap + web_search gating (T3), toolAgent runner + system prompt + recursionLimit 10 + factory injection (T4), hub types (T5), component with model/system-prompt/tool-multiselect (T6), register/palette/drop (T7), full verification incl. security (T8). All spec sections mapped.
- **Type consistency:** `ToolRef` / `ToolAgentNodeData` / `buildTools` / `BuildToolsOptions` / `BUILTIN_TOOL_IDS` / `TOOL_AGENT_RECURSION_LIMIT` / `reactAgentFactory` names are identical across every task that references them.
- **No live LLM in tests:** every runner test injects `reactAgentFactory`; every tools test injects `env` and/or `gatewayInvoke`.
- **Security:** calculator is regex-gated + recursive-descent (no eval/Function); gateway tools route only through `callGatewayMethod`; no HTTP-fetch tool.
