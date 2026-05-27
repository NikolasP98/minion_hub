# Flow Nodes v2 — SP-3: Plugin-Contributed Flow Nodes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let installed gateway plugins declare flow-editor trigger/action nodes in `minion.plugin.json`; the gateway exposes them over `flows.nodes.list`; the hub renders them with one generic component; the flow runtime executes action nodes by calling the plugin's registered gateway RPC.

**Architecture:** Plugin nodes are declarative descriptors (data, never code). A `pluginTrigger` is an entry node reusing the SP-2 trigger path; a `pluginAction` is an exec node whose work is a gateway RPC method the plugin registered via `api.registerGatewayMethod`. A flow stays one-entry→one-exec; plugin nodes are new variants of those two roles.

**Tech Stack:** TypeScript (strict). Gateway `minion/` (pnpm, vitest, branch `DEV`). Runtime `langgraph-server/` (npm, vitest, LangGraph.js, branch `dev`). Hub `minion_hub/` (bun, vitest, SvelteKit 2 + Svelte 5 runes, `@xyflow/svelte`, branch `dev`).

**Spec:** `minion_hub/docs/superpowers/specs/2026-05-26-flow-nodes-v2-sp3-design.md`

**Cross-repo type sync:** `PluginTriggerNodeData` / `PluginActionNodeData` are defined identically in `langgraph-server/src/flow/types.ts` (Task 7) and `minion_hub/.../flow-editor.svelte.ts` (Task 10). Keep field names byte-identical — this mirrors how SP-1/SP-2 kept the two type files in sync.

---

## File Structure

**Gateway (`minion/`):**
- Modify `src/plugins/types.ts` — add `FlowNodeContribution` union (Task 1).
- Modify `src/plugins/manifest.ts` — `flowNodes?` field + parser (Task 1).
- Create `src/gateway/server-methods/flows-nodes.ts` — `flows.nodes.list` handler + `collectFlowNodeDescriptors` (Task 2).
- Create `src/gateway/server-methods/flows-nodes.test.ts` (Task 2).
- Modify `src/gateway/server.impl.ts` — spread handler (Task 3).
- Modify `src/flows/trigger-manager.ts` — widen event type, default prompt branch, plugin-event subscription (Task 4).
- Modify `src/flows/trigger-manager.test.ts` (Task 4).
- Modify `src/gateway/server-methods/flows-trigger.ts` — pass plugin events into init (Task 5).
- Create `extensions/flow-example/minion.plugin.json` + `index.ts` (Task 6).
- Create `extensions/flow-example/flow-example.test.ts` (Task 6).

**Runtime (`langgraph-server/`):**
- Modify `src/flow/types.ts` — node data types + union (Task 7).
- Modify `src/gateway/client.ts` — `callGatewayMethod` (Task 8).
- Modify `src/gateway/client.test.ts` (Task 8).
- Modify `src/flow/compile-flow.ts` — validate + exec branches (Task 9).
- Modify `src/flow/compile-flow.test.ts` (Task 9).

**Hub (`minion_hub/`):**
- Modify `src/lib/state/features/flow-editor.svelte.ts` — node data types + union (Task 10).
- Create `src/lib/components/flow-editor/nodes/PluginNode.svelte` (Task 11).
- Modify `src/lib/components/flow-editor/FlowCanvas.svelte` — register + drop branches (Task 11, 12).
- Modify `src/lib/components/flow-editor/FlowSidebar.svelte` — palette section (Task 12).
- Modify `src/routes/(app)/flow-editor/[id]/+page.svelte` — activation recognizes pluginTrigger (Task 13).
- Modify `src/lib/services/gateway.svelte.ts` — re-registration recognizes pluginTrigger (Task 13).

---

## GATEWAY TASKS (`minion/`, branch `DEV`, run `pnpm test`)

### Task 1: Manifest `flowNodes` type + parser

**Files:**
- Modify: `src/plugins/types.ts` (add types near `PluginUiManifestEntry`, ~line 246)
- Modify: `src/plugins/manifest.ts` (`PluginManifest` type ~line 20-34; parser in `loadPluginManifest` ~line 149-172; return object ~line 182-200)
- Test: `src/plugins/manifest.test.ts` (create if absent; otherwise append)

- [ ] **Step 1: Write the failing test**

Create/append `src/plugins/manifest.test.ts`:

```ts
import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadPluginManifest } from "./manifest.js";

function writeManifest(obj: unknown): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "manifest-test-"));
  fs.writeFileSync(path.join(dir, "minion.plugin.json"), JSON.stringify(obj));
  return dir;
}
const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });

describe("loadPluginManifest — flowNodes", () => {
  it("parses valid trigger and action contributions", () => {
    const dir = writeManifest({
      id: "p", configSchema: { type: "object" },
      flowNodes: [
        { id: "ev", kind: "trigger", event: "p:ping", label: "Ping" },
        { id: "echo", kind: "action", method: "p.echo", label: "Echo" },
      ],
    });
    dirs.push(dir);
    const res = loadPluginManifest(dir);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.manifest.flowNodes).toHaveLength(2);
    expect(res.manifest.flowNodes![0]).toMatchObject({ id: "ev", kind: "trigger", event: "p:ping" });
    expect(res.manifest.flowNodes![1]).toMatchObject({ id: "echo", kind: "action", method: "p.echo" });
  });

  it("skips malformed entries (missing kind/event/method/label)", () => {
    const dir = writeManifest({
      id: "p", configSchema: { type: "object" },
      flowNodes: [
        { id: "ok", kind: "action", method: "p.echo", label: "Echo" },
        { id: "bad1", kind: "trigger", label: "no event" },
        { id: "bad2", kind: "action", method: "p.x" },
        { kind: "trigger", event: "p:x", label: "no id" },
        "not an object",
      ],
    });
    dirs.push(dir);
    const res = loadPluginManifest(dir);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.manifest.flowNodes).toHaveLength(1);
    expect(res.manifest.flowNodes![0].id).toBe("ok");
  });

  it("leaves flowNodes undefined when absent", () => {
    const dir = writeManifest({ id: "p", configSchema: { type: "object" } });
    dirs.push(dir);
    const res = loadPluginManifest(dir);
    expect(res.ok && res.manifest.flowNodes).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/plugins/manifest.test.ts`
Expected: FAIL (`flowNodes` not parsed / property absent).

- [ ] **Step 3: Add the types to `src/plugins/types.ts`**

Add after `PluginUiManifestEntry` (around line 246):

```ts
export type FlowNodeContributionBase = {
  id: string;
  label: string;
  description?: string;
  icon?: string;
};
export type FlowTriggerContribution = FlowNodeContributionBase & {
  kind: "trigger";
  event: string;
};
export type FlowActionContribution = FlowNodeContributionBase & {
  kind: "action";
  method: string;
};
export type FlowNodeContribution = FlowTriggerContribution | FlowActionContribution;
```

- [ ] **Step 4: Extend `PluginManifest` + parser in `src/plugins/manifest.ts`**

Add the import to the existing type-only import from `./types.js` (line 10):

```ts
import type { PluginConfigUiHint, PluginKind, PluginUiManifestEntry, FlowNodeContribution } from "./types.js";
```

Add to the `PluginManifest` type (after `secrets?`, ~line 33):

```ts
  flowNodes?: FlowNodeContribution[];
```

Add a parse helper above `loadPluginManifest` (near `normalizeStringList`, ~line 92):

```ts
function parseFlowNodes(raw: unknown): FlowNodeContribution[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: FlowNodeContribution[] = [];
  for (const item of raw) {
    if (!isRecord(item)) continue;
    const id = typeof item.id === "string" ? item.id.trim() : "";
    const label = typeof item.label === "string" ? item.label.trim() : "";
    if (!id || !label) continue;
    const description = typeof item.description === "string" ? item.description : undefined;
    const icon = typeof item.icon === "string" ? item.icon : undefined;
    if (item.kind === "trigger" && typeof item.event === "string" && item.event.trim()) {
      out.push({ id, label, description, icon, kind: "trigger", event: item.event.trim() });
    } else if (item.kind === "action" && typeof item.method === "string" && item.method.trim()) {
      out.push({ id, label, description, icon, kind: "action", method: item.method.trim() });
    }
  }
  return out.length > 0 ? out : undefined;
}
```

Inside `loadPluginManifest`, after the `ui` parsing block (~line 172, before `hotReloadConfig`):

```ts
  const flowNodes = parseFlowNodes(raw.flowNodes);
```

Add `flowNodes` to the returned `manifest` object (~line 197, after `secrets`):

```ts
      flowNodes,
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run src/plugins/manifest.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add src/plugins/types.ts src/plugins/manifest.ts src/plugins/manifest.test.ts
git commit -m "feat(plugins): parse flowNodes contributions in plugin manifest"
```

---

### Task 2: `flows.nodes.list` RPC handler + descriptor collection

**Files:**
- Create: `src/gateway/server-methods/flows-nodes.ts`
- Test: `src/gateway/server-methods/flows-nodes.test.ts`

Context: mirrors `plugins.ts` `loadRegistry()` + `plugins.ui.list`. The registry exposes `plugins: PluginRecord[]`; each record has the loaded manifest. Verify the exact accessor by reading `src/plugins/registry.ts` (`PluginRecord` shape) and how `pluginsUiList` reaches each manifest in `src/gateway/server-methods/plugins/*` — reuse the same path to get `manifest.flowNodes`. The collection function must take the registry as a parameter (pure, testable); the handler wires `loadRegistry()`.

- [ ] **Step 1: Write the failing test**

Create `src/gateway/server-methods/flows-nodes.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { collectFlowNodeDescriptors } from "./flows-nodes.js";

describe("collectFlowNodeDescriptors", () => {
  it("flattens enabled plugins' flowNodes and stamps pluginId", () => {
    const registry = {
      plugins: [
        {
          id: "wa", enabled: true,
          manifest: { id: "wa", flowNodes: [
            { id: "msg", kind: "trigger", event: "wa:message", label: "WA message" },
            { id: "send", kind: "action", method: "wa.send", label: "Send WA" },
          ] },
        },
        { id: "noflow", enabled: true, manifest: { id: "noflow" } },
        {
          id: "disabled", enabled: false,
          manifest: { id: "disabled", flowNodes: [{ id: "x", kind: "action", method: "d.x", label: "X" }] },
        },
      ],
    };
    const nodes = collectFlowNodeDescriptors(registry as never);
    expect(nodes).toHaveLength(2);
    expect(nodes).toContainEqual(expect.objectContaining({ pluginId: "wa", id: "msg", kind: "trigger", event: "wa:message" }));
    expect(nodes).toContainEqual(expect.objectContaining({ pluginId: "wa", id: "send", kind: "action", method: "wa.send" }));
  });

  it("returns empty array when no plugin contributes", () => {
    expect(collectFlowNodeDescriptors({ plugins: [] } as never)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/gateway/server-methods/flows-nodes.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `src/gateway/server-methods/flows-nodes.ts`**

> NOTE for implementer: confirm the registry/record field names by reading `src/plugins/registry.ts` and `src/gateway/server-methods/plugins.ts` (`loadRegistry`). If a `PluginRecord` stores the manifest under a different key than `.manifest`, adjust `recordManifest()` accordingly. The `enabled` flag and `loadRegistry` helper already exist (used by `plugins.ui.list`).

```ts
import { loadConfig } from "../../config/index.js";
import { resolveAgentWorkspaceDir, resolveDefaultAgentId } from "../../config/agents.js";
import { loadMinionPlugins } from "../../plugins/loader.js";
import type { PluginRegistry } from "../../plugins/registry.js";
import type { FlowNodeContribution } from "../../plugins/types.js";
import { ErrorCodes, errorShape } from "../protocol/index.js";
import type { GatewayRequestHandlers } from "./types.js";

export type FlowNodeDescriptor = FlowNodeContribution & { pluginId: string };

/** Pure: flatten enabled plugins' flowNodes into descriptors. Exported for tests. */
export function collectFlowNodeDescriptors(registry: PluginRegistry): FlowNodeDescriptor[] {
  const out: FlowNodeDescriptor[] = [];
  for (const rec of registry.plugins) {
    if (rec.enabled === false) continue;
    const flowNodes = recordManifest(rec)?.flowNodes;
    if (!flowNodes) continue;
    for (const node of flowNodes) out.push({ ...node, pluginId: rec.id });
  }
  return out;
}

function recordManifest(rec: PluginRegistry["plugins"][number]): { flowNodes?: FlowNodeContribution[] } | undefined {
  // PluginRecord stores its parsed manifest; confirm key in registry.ts.
  return (rec as unknown as { manifest?: { flowNodes?: FlowNodeContribution[] } }).manifest;
}

function loadRegistry(): PluginRegistry {
  const cfg = loadConfig();
  const workspaceDir = resolveAgentWorkspaceDir(cfg, resolveDefaultAgentId(cfg));
  return loadMinionPlugins({
    config: cfg, cache: true, workspaceDir,
    logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
  });
}

export function createFlowsNodesHandlers(): GatewayRequestHandlers {
  return {
    "flows.nodes.list": ({ respond }) => {
      try {
        const nodes = collectFlowNodeDescriptors(loadRegistry());
        respond(true, { nodes });
      } catch (err) {
        respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String((err as Error).message ?? err)));
      }
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/gateway/server-methods/flows-nodes.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Type-check**

Run: `pnpm tsgo` (or the project's typecheck). Fix import paths flagged for `loadConfig`/`resolveAgentWorkspaceDir`/`loadMinionPlugins` by matching the exact paths used in `src/gateway/server-methods/plugins.ts`.
Expected: no new type errors in `flows-nodes.ts`.

- [ ] **Step 6: Commit**

```bash
git add src/gateway/server-methods/flows-nodes.ts src/gateway/server-methods/flows-nodes.test.ts
git commit -m "feat(gateway): flows.nodes.list RPC + collectFlowNodeDescriptors"
```

---

### Task 3: Wire `flows.nodes.list` into the gateway

**Files:**
- Modify: `src/gateway/server.impl.ts` (import ~line 116; spread ~line 956)

- [ ] **Step 1: Add the import**

After line 116 (`import { createFlowsTriggerHandlers } ...`):

```ts
import { createFlowsNodesHandlers } from "./server-methods/flows-nodes.js";
```

- [ ] **Step 2: Add the spread**

In the `extraHandlers` object (~line 956, right after `...createFlowsTriggerHandlers(),`):

```ts
    ...createFlowsNodesHandlers(),
```

- [ ] **Step 3: Type-check + build**

Run: `pnpm tsgo`
Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
git add src/gateway/server.impl.ts
git commit -m "feat(gateway): register flows.nodes.list handler"
```

---

### Task 4: Trigger-manager accepts plugin-declared events

**Files:**
- Modify: `src/flows/trigger-manager.ts`
- Modify: `src/flows/trigger-manager.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/flows/trigger-manager.test.ts`:

```ts
import { extractPrompt } from "./trigger-manager.js";

describe("extractPrompt — plugin (unknown) events", () => {
  it("uses ctx.content first for an unknown event", () => {
    const ev = { context: { content: "hi" }, sessionKey: "s" } as never;
    expect(extractPrompt(ev, "wa:message" as never)).toBe("hi");
  });
  it("falls back to ctx.text then JSON for an unknown event", () => {
    const ev1 = { context: { text: "yo" }, sessionKey: "s" } as never;
    expect(extractPrompt(ev1, "wa:message" as never)).toBe("yo");
    const ev2 = { context: { foo: 1 }, sessionKey: "s" } as never;
    expect(extractPrompt(ev2, "wa:message" as never)).toBe(JSON.stringify({ foo: 1 }));
  });
});
```

Also add a subscription test (uses `initializeTriggerHandlers`):

```ts
import { initializeTriggerHandlers } from "./trigger-manager.js";
// If the test file already mocks ../hooks/internal-hooks.js with a spy on registerInternalHook,
// reuse it; otherwise add: vi.mock("../hooks/internal-hooks.js", () => ({ registerInternalHook: vi.fn() }));

describe("initializeTriggerHandlers — plugin events", () => {
  it("subscribes built-ins plus distinct plugin events, idempotently", async () => {
    const hooks = await import("../hooks/internal-hooks.js");
    const spy = hooks.registerInternalHook as unknown as { mock: { calls: unknown[][] } };
    const before = spy.mock.calls.length;
    initializeTriggerHandlers(["wa:message", "wa:message", "tg:update"]);
    initializeTriggerHandlers(["wa:message"]); // idempotent: no new subscriptions
    const added = spy.mock.calls.slice(before).map((c) => c[0]);
    expect(added).toContain("wa:message");
    expect(added).toContain("tg:update");
    expect(added.filter((e) => e === "wa:message")).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/flows/trigger-manager.test.ts`
Expected: FAIL (`extractPrompt` has no default branch / `initializeTriggerHandlers` ignores arg).

- [ ] **Step 3: Implement the changes in `src/flows/trigger-manager.ts`**

Widen the event type (line 7-13) — keep built-ins documented but allow any string:

```ts
export type BuiltinTriggerEventKey =
  | "message:received"
  | "message:sent"
  | "agent:bootstrap"
  | "memory:node_created"
  | "memory:node_updated"
  | "memory:node_deleted";
export type TriggerEventKey = BuiltinTriggerEventKey | (string & {});
```

Add a `default` branch to `extractPrompt` (after the `memory:node_deleted` case, line 53). Change the `switch` so unknown keys fall through:

```ts
export function extractPrompt(event: InternalHookEvent, eventKey: TriggerEventKey): string {
  const ctx = event.context;
  switch (eventKey) {
    case "message:received":
    case "message:sent":
      return (ctx.content as string | undefined) ?? "";
    case "agent:bootstrap":
      return `Agent ${(ctx.agentId as string | undefined) ?? "unknown"} bootstrapped for session ${event.sessionKey}`;
    case "memory:node_created":
      return `New memory: ${(ctx.label as string | undefined) ?? "unknown"} — ${JSON.stringify(ctx.data ?? {})}`;
    case "memory:node_updated":
      return `Memory updated: ${(ctx.label as string | undefined) ?? "unknown"} — ${JSON.stringify(ctx.data ?? {})}`;
    case "memory:node_deleted":
      return `Memory deleted: ${(ctx.label as string | undefined) ?? "unknown"}`;
    default:
      return (ctx.content as string | undefined)
        ?? (ctx.text as string | undefined)
        ?? JSON.stringify(ctx ?? {});
  }
}
```

Replace the `SUPPORTED_EVENTS` + `initialized` boolean (lines 108-128) with a subscribed `Set`:

```ts
const SUPPORTED_EVENTS: BuiltinTriggerEventKey[] = [
  "message:received", "message:sent", "agent:bootstrap",
  "memory:node_created", "memory:node_updated", "memory:node_deleted",
];

const subscribed = new Set<string>();

/** Call at gateway startup (and when plugin events are discovered). Idempotent per event. */
export function initializeTriggerHandlers(pluginEvents: string[] = []): void {
  const events = [...SUPPORTED_EVENTS, ...pluginEvents];
  for (const key of events) {
    if (subscribed.has(key)) continue;
    subscribed.add(key);
    registerInternalHook(key, (event) => void handleTriggerEvent(event, key));
  }
  if (!subscribed.has("__logged__")) {
    subscribed.add("__logged__");
    log.info("Trigger handlers initialized");
  }
}
```

(`handleTriggerEvent`'s second param type is `TriggerEventKey`; it already filters by `reg.event !== eventKey`, which works for plugin events too.)

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/flows/trigger-manager.test.ts`
Expected: PASS (existing 9 + new tests).

- [ ] **Step 5: Commit**

```bash
git add src/flows/trigger-manager.ts src/flows/trigger-manager.test.ts
git commit -m "feat(flows): trigger-manager accepts plugin-declared events"
```

---

### Task 5: Feed plugin trigger events into trigger init

**Files:**
- Modify: `src/gateway/server-methods/flows-trigger.ts`

Context: `createFlowsTriggerHandlers` calls `initializeTriggerHandlers()` once. Now pass the plugin trigger events discovered from the registry so their hooks get subscribed at startup.

- [ ] **Step 1: Update `createFlowsTriggerHandlers` in `src/gateway/server-methods/flows-trigger.ts`**

Replace the init block (lines 18-28) to collect plugin trigger events:

```ts
import { collectFlowNodeDescriptors } from "./flows-nodes.js";
import { loadConfig } from "../../config/index.js";
import { resolveAgentWorkspaceDir, resolveDefaultAgentId } from "../../config/agents.js";
import { loadMinionPlugins } from "../../plugins/loader.js";

let hooksInitialized = false;

function pluginTriggerEvents(): string[] {
  try {
    const cfg = loadConfig();
    const registry = loadMinionPlugins({
      config: cfg, cache: true,
      workspaceDir: resolveAgentWorkspaceDir(cfg, resolveDefaultAgentId(cfg)),
      logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
    });
    return collectFlowNodeDescriptors(registry)
      .filter((n) => n.kind === "trigger")
      .map((n) => (n as { event: string }).event);
  } catch {
    return [];
  }
}

export function createFlowsTriggerHandlers(): GatewayRequestHandlers {
  if (!hooksInitialized) {
    initializeTriggerHandlers(pluginTriggerEvents());
    hooksInitialized = true;
  }
  // ... existing returned handlers unchanged ...
```

> DRY note: `loadRegistry` logic is duplicated between `flows-nodes.ts` and here. If the implementer prefers, export `loadRegistry` from `flows-nodes.ts` and reuse it. Either is acceptable; do not over-engineer a shared module for two call sites.

- [ ] **Step 2: Type-check**

Run: `pnpm tsgo`
Expected: no new errors.

- [ ] **Step 3: Run trigger tests (regression)**

Run: `pnpm vitest run src/flows/trigger-manager.test.ts src/gateway/server-methods/flows-trigger.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/gateway/server-methods/flows-trigger.ts
git commit -m "feat(gateway): subscribe plugin trigger events at startup"
```

---

### Task 6: Reference plugin `flow-example`

**Files:**
- Create: `extensions/flow-example/minion.plugin.json`
- Create: `extensions/flow-example/index.ts`
- Create: `extensions/flow-example/flow-example.test.ts`

Context: a minimal plugin proving the full loop. It declares one trigger + one action and registers the action's gateway method. Read an existing simple extension's `index.ts` (e.g. a small one under `extensions/`) to copy the exact `MinionPluginDefinition` / `register(api)` export shape and the `GatewayRequestHandler` signature (`{ params, respond }`).

- [ ] **Step 1: Write the failing test**

Create `extensions/flow-example/flow-example.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import plugin from "./index.js";

describe("flow-example plugin", () => {
  it("registers the flowExample.echo gateway method that echoes input", async () => {
    const methods: Record<string, (ctx: { params: unknown; respond: (ok: boolean, payload?: unknown) => void }) => void> = {};
    const api = {
      registerGatewayMethod: (m: string, h: never) => { methods[m] = h as never; },
    } as never;
    plugin.register!(api);
    expect(typeof methods["flowExample.echo"]).toBe("function");

    let captured: unknown;
    methods["flowExample.echo"]({ params: { input: "ping" }, respond: (_ok, payload) => { captured = payload; } });
    expect(captured).toEqual({ reply: "echo: ping" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run extensions/flow-example/flow-example.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Create the manifest `extensions/flow-example/minion.plugin.json`**

```json
{
  "id": "flow-example",
  "name": "Flow Example",
  "description": "Reference plugin contributing one flow trigger and one flow action.",
  "configSchema": { "type": "object", "additionalProperties": false, "properties": {} },
  "flowNodes": [
    { "id": "ping", "kind": "trigger", "event": "flow-example:ping", "label": "Example ping", "icon": "Zap" },
    { "id": "echo", "kind": "action", "method": "flowExample.echo", "label": "Example echo", "icon": "Repeat" }
  ]
}
```

- [ ] **Step 4: Create `extensions/flow-example/index.ts`**

> Match the real export shape from a sibling extension. The shape below assumes `MinionPluginDefinition` with a `register(api)` that calls `api.registerGatewayMethod(method, handler)` where handler is `({ params, respond }) => void` and `respond(ok, payload)`.

```ts
import type { MinionPluginDefinition, MinionPluginApi } from "../../src/plugins/types.js";

const plugin: MinionPluginDefinition = {
  id: "flow-example",
  register(api: MinionPluginApi) {
    api.registerGatewayMethod("flowExample.echo", ({ params, respond }) => {
      const input = typeof (params as { input?: unknown })?.input === "string"
        ? (params as { input: string }).input
        : "";
      respond(true, { reply: `echo: ${input}` });
    });
  },
};

export default plugin;
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run extensions/flow-example/flow-example.test.ts`
Expected: PASS.

- [ ] **Step 6: Verify discovery + flows.nodes.list integration**

Add to `flows-nodes.test.ts` (or a new integration test) — load the real bundled registry and assert the example appears. If loading the full registry in a unit test is heavy, instead assert via a focused test that `collectFlowNodeDescriptors` returns the example when given a registry containing the parsed `flow-example` manifest (reuse `loadPluginManifest` on `extensions/flow-example`). Implementer picks the lighter approach.

```ts
import { loadPluginManifest } from "../../plugins/manifest.js";
import path from "node:path";
it("surfaces the flow-example contributions", () => {
  // process.cwd() is the minion/ package root under vitest.
  const res = loadPluginManifest(path.resolve(process.cwd(), "extensions/flow-example"));
  expect(res.ok).toBe(true);
  if (!res.ok) return;
  const fake = { plugins: [{ id: "flow-example", enabled: true, manifest: res.manifest }] };
  const nodes = collectFlowNodeDescriptors(fake as never);
  expect(nodes.map((n) => n.id).sort()).toEqual(["echo", "ping"]);
});
```

Run: `pnpm vitest run src/gateway/server-methods/flows-nodes.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add extensions/flow-example/ src/gateway/server-methods/flows-nodes.test.ts
git commit -m "feat(extensions): flow-example reference plugin (trigger + action)"
```

---

## RUNTIME TASKS (`langgraph-server/`, branch `dev`, run `npm test`)

### Task 7: Plugin node data types

**Files:**
- Modify: `src/flow/types.ts` (lines 27-41)

- [ ] **Step 1: Add the types after `TriggerNodeData` (line 34)**

```ts
export type PluginTriggerNodeData = {
  pluginId: string;
  contributionId: string;
  event: string;
  label: string;
  deliverResponse: boolean;
};

export type PluginActionNodeData = {
  pluginId: string;
  contributionId: string;
  method: string;
  label: string;
};
```

- [ ] **Step 2: Extend the `FlowNode` union (lines 36-41)**

```ts
export type FlowNode = {
  id: string;
  type: 'agent' | 'promptBox' | 'llm' | 'trigger' | 'pluginTrigger' | 'pluginAction';
  position: { x: number; y: number };
  data:
    | AgentNodeData
    | PromptBoxData
    | LLMNodeData
    | TriggerNodeData
    | PluginTriggerNodeData
    | PluginActionNodeData;
};
```

- [ ] **Step 3: Type-check**

Run: `npm run typecheck` (or `npx tsc --noEmit`)
Expected: no errors (types only added).

- [ ] **Step 4: Commit**

```bash
git add src/flow/types.ts
git commit -m "feat(flow): add pluginTrigger/pluginAction node data types"
```

---

### Task 8: `callGatewayMethod` on the gateway client

**Files:**
- Modify: `src/gateway/client.ts` (after `sendAgentTurn`, line 142)
- Modify: `src/gateway/client.test.ts` (if absent, create)

- [ ] **Step 1: Write the failing test**

Append to `src/gateway/client.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { extractReply } from "./client.js";

// callGatewayMethod uses extractReply on the RPC result; verify the reply contract.
describe("extractReply — plugin action reply", () => {
  it("reads { reply } from a plugin action response", () => {
    expect(extractReply({ reply: "echo: hi" })).toBe("echo: hi");
  });
});
```

(`callGatewayMethod` itself depends on a live WS; cover its reply-parsing via `extractReply`, and the wiring via the compile-flow test in Task 9 with an injected client.)

- [ ] **Step 2: Run test to verify it fails (or passes trivially)**

Run: `npm test -- src/gateway/client.test.ts`
Expected: PASS for the `extractReply` assertion if the file already imports correctly; if `client.test.ts` is new, this establishes the harness.

- [ ] **Step 3: Implement `callGatewayMethod` in `src/gateway/client.ts`**

Add after `sendAgentTurn` (line 142):

```ts
export async function callGatewayMethod(
  method: string,
  params: Record<string, unknown>,
): Promise<string> {
  const result = await request(method, params);
  const reply = extractReply(result);
  if (reply === null) {
    throw new Error(
      `Gateway method "${method}" returned no recognisable reply. Raw: ${JSON.stringify(result)}`,
    );
  }
  return reply;
}
```

- [ ] **Step 4: Run test + typecheck**

Run: `npm test -- src/gateway/client.test.ts && npm run typecheck`
Expected: PASS, no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/gateway/client.ts src/gateway/client.test.ts
git commit -m "feat(gateway-client): callGatewayMethod for plugin action nodes"
```

---

### Task 9: compileFlow handles pluginTrigger + pluginAction

**Files:**
- Modify: `src/flow/compile-flow.ts` (validateFlowShape lines 18-48; entry resolution lines 88-102; `CompileOptions` GatewayClient interface lines 62-79; `buildExecNode` lines 116-163)
- Modify: `src/flow/compile-flow.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `src/flow/compile-flow.test.ts`:

```ts
import type { PluginActionNodeData, PluginTriggerNodeData } from './types.js';

const pluginAction: FlowNode = {
  id: 'pa1', type: 'pluginAction', position: { x: 200, y: 0 },
  data: { pluginId: 'flow-example', contributionId: 'echo', method: 'flowExample.echo', label: 'Example echo' } satisfies PluginActionNodeData,
};
const edgeToPluginAction: FlowEdge = {
  id: 'e-pa', source: 'p1', sourceHandle: 'prompt-out', target: 'pa1', targetHandle: 'in', type: 'flow',
};
const pluginTrigger: FlowNode = {
  id: 'pt1', type: 'pluginTrigger', position: { x: 0, y: 0 },
  data: { pluginId: 'flow-example', contributionId: 'ping', event: 'flow-example:ping', label: 'Example ping', deliverResponse: false } satisfies PluginTriggerNodeData,
};
const edgeFromPluginTrigger: FlowEdge = {
  id: 'e-pt', source: 'pt1', sourceHandle: 'out', target: 'l1', targetHandle: 'in', type: 'flow',
};

describe('validateFlowShape — plugin nodes', () => {
  it('accepts promptBox → pluginAction', () => {
    expect(() => validateFlowShape([prompt, pluginAction], [edgeToPluginAction])).not.toThrow();
  });
  it('accepts pluginTrigger → llm', () => {
    expect(() => validateFlowShape([pluginTrigger, llmNode], [edgeFromPluginTrigger])).not.toThrow();
  });
  it('rejects pluginTrigger + promptBox together', () => {
    const ep: FlowEdge = { id: 'ep', source: 'p1', sourceHandle: 'prompt-out', target: 'l1', targetHandle: 'in', type: 'flow' };
    expect(() => validateFlowShape([pluginTrigger, prompt, llmNode], [edgeFromPluginTrigger, ep])).toThrow(UnsupportedFlowError);
  });
  it('rejects two execs: pluginAction + llm', () => {
    expect(() => validateFlowShape([prompt, pluginAction, llmNode], [edgeToPluginAction, edgeToLlm])).toThrow(UnsupportedFlowError);
  });
});

describe('compileFlow — pluginAction node', () => {
  it('calls gatewayClient.callGatewayMethod with method + input and returns reply', async () => {
    const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
    const fakeGateway = {
      async sendAgentTurn() { return 'unused'; },
      async callGatewayMethod(method: string, params: Record<string, unknown>) {
        calls.push({ method, params });
        return 'echo: Hello';
      },
    };
    const { graph, initialState } = compileFlow([prompt, pluginAction], [edgeToPluginAction], { gatewayClient: fakeGateway });
    const result = await graph.invoke(initialState);
    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe('flowExample.echo');
    expect(calls[0].params.input).toBe('Hello');
    expect(result.messages[result.messages.length - 1].content).toBe('echo: Hello');
  });
});

describe('compileFlow — pluginTrigger node', () => {
  it('requires initialPrompt and seeds it', async () => {
    const fakeModel = { async invoke(msgs: BaseMessage[]) { return new AIMessage(`pt-echo:${String(msgs[msgs.length - 1].content)}`); } };
    const { graph, initialState } = compileFlow([pluginTrigger, llmNode], [edgeFromPluginTrigger], { model: fakeModel, initialPrompt: 'evt' });
    expect(initialState.messages[0].content).toBe('evt');
    const result = await graph.invoke(initialState);
    expect(result.messages[result.messages.length - 1].content).toBe('pt-echo:evt');
  });
  it('throws when pluginTrigger present but initialPrompt missing', () => {
    expect(() => compileFlow([pluginTrigger, llmNode], [edgeFromPluginTrigger], {})).toThrow(UnsupportedFlowError);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- src/flow/compile-flow.test.ts`
Expected: FAIL (plugin types not handled).

- [ ] **Step 3: Extend `validateFlowShape` (lines 18-48)**

Change the entry/exec filters:

```ts
  const triggers = nodes.filter((n) => n.type === 'trigger' || n.type === 'pluginTrigger');
  const execNodes = nodes.filter((n) => n.type === 'agent' || n.type === 'llm' || n.type === 'pluginAction');
```

(The rest — prompt/trigger mutual exclusion, counts, connectivity — works unchanged because `pluginTrigger` is grouped with triggers and `pluginAction` with execs.)

- [ ] **Step 4: Extend entry resolution + `GatewayClient` interface + `buildExecNode`**

Entry node lookup (line 88):

```ts
  const entryNode = nodes.find((n) => n.type === 'promptBox' || n.type === 'trigger' || n.type === 'pluginTrigger')!;
  const execNode = nodes.find((n) => n.type === 'agent' || n.type === 'llm' || n.type === 'pluginAction')!;
```

Trigger prompt branch (line 93) — accept both trigger kinds:

```ts
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
```

Extend the `GatewayClient` interface (lines 62-70) to include the optional method:

```ts
interface GatewayClient {
  sendAgentTurn(
    agentId: string, prompt: string,
    sessionMode: 'ephemeral' | 'shared', runId: string, nodeId: string,
  ): Promise<string>;
  callGatewayMethod?(method: string, params: Record<string, unknown>): Promise<string>;
}
```

Add the import (line 14):

```ts
import { sendAgentTurn, callGatewayMethod } from '../gateway/client.js';
import type { PluginActionNodeData } from './types.js';
```

Add a `pluginAction` branch at the top of `buildExecNode` (after line 120, before the `llm` branch):

```ts
  if (node.type === 'pluginAction') {
    const data = node.data as PluginActionNodeData;
    const gc = opts.gatewayClient ?? { sendAgentTurn, callGatewayMethod };
    return async (state) => {
      const lastHuman = [...state.messages].reverse().find((m) => m._getType() === 'human');
      if (!lastHuman) {
        throw new Error('Plugin action node received no human message in state — cannot dispatch.');
      }
      const invoke = gc.callGatewayMethod ?? callGatewayMethod;
      const reply = await invoke(data.method, {
        input: String(lastHuman.content), runId, nodeId: node.id,
      });
      return { messages: [new AIMessage(reply)] };
    };
  }
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- src/flow/compile-flow.test.ts`
Expected: PASS (existing + new).

- [ ] **Step 6: Run the full runtime suite + typecheck**

Run: `npm test && npm run typecheck`
Expected: all PASS, no type errors.

- [ ] **Step 7: Commit**

```bash
git add src/flow/compile-flow.ts src/flow/compile-flow.test.ts
git commit -m "feat(flow): compileFlow supports pluginTrigger + pluginAction nodes"
```

---

## HUB TASKS (`minion_hub/`, branch `dev`, run `bun run test`)

### Task 10: Hub node data types + `FlowNode` union

**Files:**
- Modify: `src/lib/state/features/flow-editor.svelte.ts` (after `TriggerNodeData` line 45; union lines 47-52)

- [ ] **Step 1: Add the types after `TriggerNodeData` (line 45)**

```ts
export type PluginTriggerNodeData = {
  pluginId: string;
  contributionId: string;
  event: string;
  label: string;
  deliverResponse: boolean;
};

export type PluginActionNodeData = {
  pluginId: string;
  contributionId: string;
  method: string;
  label: string;
};
```

- [ ] **Step 2: Extend the `FlowNode` union (lines 47-52)**

```ts
export type FlowNode = {
  id: string;
  type: 'agent' | 'promptBox' | 'llm' | 'trigger' | 'pluginTrigger' | 'pluginAction';
  position: { x: number; y: number };
  data:
    | AgentNodeData
    | PromptBoxData
    | LLMNodeData
    | TriggerNodeData
    | PluginTriggerNodeData
    | PluginActionNodeData;
};
```

- [ ] **Step 3: Type-check**

Run: `bun run check`
Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
git add src/lib/state/features/flow-editor.svelte.ts
git commit -m "feat(flow-editor): add plugin node data types to hub state"
```

---

### Task 11: Generic `PluginNode.svelte` + register in canvas

**Files:**
- Create: `src/lib/components/flow-editor/nodes/PluginNode.svelte`
- Modify: `src/lib/components/flow-editor/FlowCanvas.svelte` (imports line 15-18; nodeTypes line 37-42)

Context: one component renders both kinds. Branch on whether `data` has `event` (trigger) or `method` (action). Mirror `TriggerNode.svelte` (entry: output handle only + deliver toggle) and `LLMNode.svelte` (exec: input + output handles). Use a violet accent to distinguish plugin nodes.

- [ ] **Step 1: Create `src/lib/components/flow-editor/nodes/PluginNode.svelte`**

```svelte
<script lang="ts">
  import { Handle, Position } from '@xyflow/svelte';
  import type { NodeProps } from '@xyflow/svelte';
  import type { PluginTriggerNodeData, PluginActionNodeData } from '$lib/state/features/flow-editor.svelte';
  import { flowEditorState, setNodes } from '$lib/state/features/flow-editor.svelte';
  import { Puzzle } from 'lucide-svelte';

  let { data, id }: NodeProps & { data: PluginTriggerNodeData | PluginActionNodeData } = $props();

  const isTrigger = $derived('event' in data);

  function handleDeliverChange(e: Event) {
    const deliverResponse = (e.target as HTMLInputElement).checked;
    const next = flowEditorState.nodes.map((n) =>
      n.id === id ? { ...n, data: { ...n.data, deliverResponse } } : n,
    );
    setNodes(next);
  }
</script>

{#if !isTrigger}
  <Handle type="target" position={Position.Left} id="in" class="!w-3 !h-3 !border-2 !border-violet-400 !bg-violet-900" />
{/if}
<Handle type="source" position={Position.Right} id="out" class="!w-3 !h-3 !border-2 !border-violet-400 !bg-violet-900" />

<div class="relative bg-bg2 border rounded-xl px-4 py-3 min-w-48 max-w-60 shadow-lg select-none border-border hover:border-border/80">
  <div class="flex items-center gap-2 mb-1">
    <div class="w-6 h-6 rounded-md bg-violet-500/20 flex items-center justify-center shrink-0">
      <Puzzle size={12} class="text-violet-400" />
    </div>
    <span class="text-xs font-semibold text-foreground truncate">{data.label}</span>
  </div>
  <div class="text-[9px] text-muted/70 mb-1">
    {data.pluginId} · {isTrigger ? (data as PluginTriggerNodeData).event : (data as PluginActionNodeData).method}
  </div>

  {#if isTrigger}
    <label class="flex items-center gap-1.5 cursor-pointer">
      <input
        type="checkbox"
        class="w-3 h-3 accent-violet-400"
        checked={(data as PluginTriggerNodeData).deliverResponse}
        onclick={(e) => e.stopPropagation()}
        onchange={handleDeliverChange}
      />
      <span class="text-[10px] text-muted">Reply to channel</span>
    </label>
  {/if}
</div>
```

- [ ] **Step 2: Register in `FlowCanvas.svelte`**

Add import (after line 18):

```ts
  import PluginNode from './nodes/PluginNode.svelte';
```

Add to `nodeTypes` (line 37-42):

```ts
  const nodeTypes: NodeTypes = {
    agent: AgentNode,
    promptBox: PromptBoxNode,
    llm: LLMNode,
    trigger: TriggerNode,
    pluginTrigger: PluginNode,
    pluginAction: PluginNode,
  };
```

- [ ] **Step 3: Type-check**

Run: `bun run check`
Expected: no new errors. (Svelte MCP autofixer may be used to validate the component — see svelte skill.)

- [ ] **Step 4: Commit**

```bash
git add src/lib/components/flow-editor/nodes/PluginNode.svelte src/lib/components/flow-editor/FlowCanvas.svelte
git commit -m "feat(flow-editor): generic PluginNode component + canvas registration"
```

---

### Task 12: Palette "Plugin nodes" section + drop handler

**Files:**
- Modify: `src/lib/components/flow-editor/FlowSidebar.svelte` (script + expanded palette template)
- Modify: `src/lib/components/flow-editor/FlowCanvas.svelte` (`handleDrop` payload type line 71; branches after line 120)

Context: the sidebar already imports `sendRequest` is NOT present — it uses `gw` for agents. Plugin descriptors are fetched client-side via `sendRequest('flows.nodes.list', {})` from `$lib/services/gateway.svelte` (same path `LLMNode.svelte` uses for `models.list`).

- [ ] **Step 1: Fetch descriptors in `FlowSidebar.svelte` script**

Add imports + state (after line 9):

```ts
  import { sendRequest } from '$lib/services/gateway.svelte';

  interface FlowNodeDescriptor {
    pluginId: string; id: string; kind: 'trigger' | 'action';
    label: string; description?: string; icon?: string;
    event?: string; method?: string;
  }
  let pluginNodes = $state<FlowNodeDescriptor[]>([]);
```

In the existing `onMount` (line 13-15), add the fetch:

```ts
  onMount(async () => {
    loadBuiltAgents();
    try {
      const res = await sendRequest('flows.nodes.list', {}) as { nodes?: FlowNodeDescriptor[] } | null;
      if (res?.nodes) pluginNodes = res.nodes;
    } catch {
      pluginNodes = [];
    }
  });
```

Add a grouped derived (after `pluginNodes`):

```ts
  const pluginGroups = $derived(
    Object.entries(
      pluginNodes.reduce<Record<string, FlowNodeDescriptor[]>>((acc, n) => {
        (acc[n.pluginId] ??= []).push(n); return acc;
      }, {}),
    ),
  );
```

Add an `addPluginNode` + extend `handleDragStart`'s payload type:

```ts
  function pluginNodeData(d: FlowNodeDescriptor) {
    return d.kind === 'trigger'
      ? { pluginId: d.pluginId, contributionId: d.id, event: d.event!, label: d.label, deliverResponse: false }
      : { pluginId: d.pluginId, contributionId: d.id, method: d.method!, label: d.label };
  }

  function addPluginNode(d: FlowNodeDescriptor) {
    const node: FlowNode = {
      id: makeId(),
      type: d.kind === 'trigger' ? 'pluginTrigger' : 'pluginAction',
      position: getDropPosition(),
      data: pluginNodeData(d) as FlowNode['data'],
    };
    setNodes([...flowEditorState.nodes, node]);
  }
```

Change `handleDragStart`'s `payload` parameter type (line 85) to allow the plugin payload shape:

```ts
  function handleDragStart(
    e: DragEvent,
    payload:
      | { type: 'agent' | 'promptBox' | 'llm' | 'trigger'; agentId?: string; label?: string }
      | { type: 'pluginTrigger' | 'pluginAction'; descriptor: FlowNodeDescriptor },
  ) {
    if (!e.dataTransfer) return;
    e.dataTransfer.effectAllowed = 'copy';
    e.dataTransfer.setData('application/flow-node', JSON.stringify(payload));
  }
```

- [ ] **Step 2: Add the palette section (expanded view)**

In the expanded `<div class="flex-1 overflow-y-auto py-3 px-2 space-y-5">` block, after the Built Agents section (after line 295, before the closing `</div>`):

```svelte
      {#if pluginGroups.length > 0}
        {#each pluginGroups as [pluginId, nodes] (pluginId)}
          <div>
            <p class="text-[9px] font-semibold text-muted/50 uppercase tracking-widest px-1 mb-1.5">
              {pluginId}
            </p>
            <div class="flex flex-col gap-0.5">
              {#each nodes as d (d.id)}
                <button
                  onclick={() => addPluginNode(d)}
                  draggable="true"
                  ondragstart={(e) => handleDragStart(e, { type: d.kind === 'trigger' ? 'pluginTrigger' : 'pluginAction', descriptor: d })}
                  class="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-left hover:bg-bg3 transition-colors border border-transparent hover:border-border/60"
                >
                  <div class="w-6 h-6 rounded bg-violet-500/20 flex items-center justify-center shrink-0 text-[10px] text-violet-400">
                    {d.kind === 'trigger' ? '⚡' : '🧩'}
                  </div>
                  <div class="min-w-0">
                    <div class="text-xs font-medium text-foreground truncate">{d.label}</div>
                    <div class="text-[10px] text-muted truncate">{d.kind}</div>
                  </div>
                </button>
              {/each}
            </div>
          </div>
        {/each}
      {/if}
```

- [ ] **Step 3: Extend `FlowCanvas.svelte` drop handler**

Widen the `payload` type (line 71) and add branches. Replace line 71:

```ts
    let payload: {
      type: 'agent' | 'promptBox' | 'llm' | 'trigger' | 'pluginTrigger' | 'pluginAction';
      agentId?: string; label?: string;
      descriptor?: { pluginId: string; id: string; kind: 'trigger' | 'action'; label: string; event?: string; method?: string };
    };
```

Add imports (line 33-34 area) for the new data types:

```ts
    type PluginTriggerNodeData,
    type PluginActionNodeData,
```

Add branches after the `trigger` branch (after line 120):

```ts
    } else if (payload.type === 'pluginTrigger' && payload.descriptor) {
      const d = payload.descriptor;
      const node: FlowNode = {
        id: makeId(), type: 'pluginTrigger', position,
        data: { pluginId: d.pluginId, contributionId: d.id, event: d.event ?? '', label: d.label, deliverResponse: false } satisfies PluginTriggerNodeData,
      };
      setNodes([...flowEditorState.nodes, node]);
    } else if (payload.type === 'pluginAction' && payload.descriptor) {
      const d = payload.descriptor;
      const node: FlowNode = {
        id: makeId(), type: 'pluginAction', position,
        data: { pluginId: d.pluginId, contributionId: d.id, method: d.method ?? '', label: d.label } satisfies PluginActionNodeData,
      };
      setNodes([...flowEditorState.nodes, node]);
    }
```

- [ ] **Step 4: Type-check**

Run: `bun run check`
Expected: no new errors.

- [ ] **Step 5: Manual verification (no unit test for DnD)**

With gateway running and the `flow-example` plugin discoverable: `bun run dev`, open the flow editor, confirm a "flow-example" palette section shows "Example ping" + "Example echo". Drag the action onto the canvas → a violet PluginNode appears showing `flow-example · flowExample.echo`. Drag a Prompt Box, connect → action, click Run → console shows `echo: <prompt>`. If you cannot run the gateway, state so explicitly.

- [ ] **Step 6: Commit**

```bash
git add src/lib/components/flow-editor/FlowSidebar.svelte src/lib/components/flow-editor/FlowCanvas.svelte
git commit -m "feat(flow-editor): plugin nodes palette section + drop handling"
```

---

### Task 13: Activation recognizes `pluginTrigger`

**Files:**
- Modify: `src/routes/(app)/flow-editor/[id]/+page.svelte` (line 23 `hasTrigger`; lines 36-48 register/unregister)
- Modify: `src/lib/services/gateway.svelte.ts` (re-registration loop lines 795-824)

Context: a `pluginTrigger` is an entry node, so the existing Activate button + re-register loop must treat it like a `trigger` and pull `event` + `deliverResponse` from its data.

- [ ] **Step 1: Update `hasTrigger` + node lookup in `+page.svelte`**

Line 23:

```ts
  const hasTrigger = $derived(
    flowEditorState.nodes.some((n) => n.type === 'trigger' || n.type === 'pluginTrigger'),
  );
```

Lines 36-46 — find either trigger kind; both carry `event` + `deliverResponse`:

```ts
      const triggerNode = flowEditorState.nodes.find(
        (n) => n.type === 'trigger' || n.type === 'pluginTrigger',
      );
      if (!triggerNode) return;
      const td = triggerNode.data as { event: string; deliverResponse: boolean; filterChannelId?: string; filterAgentId?: string };
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
```

- [ ] **Step 2: Update re-registration loop in `gateway.svelte.ts` (line 802)**

```ts
          const triggerNode = flow.nodes.find(
            (n) => n.type === 'trigger' || n.type === 'pluginTrigger',
          );
```

(The rest of the loop reads `td.event` / `td.deliverResponse`, which both node kinds provide — unchanged.)

- [ ] **Step 3: Type-check**

Run: `bun run check`
Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
git add "src/routes/(app)/flow-editor/[id]/+page.svelte" src/lib/services/gateway.svelte.ts
git commit -m "feat(flow-editor): activate/re-register recognizes pluginTrigger nodes"
```

---

## Final Verification (after all tasks)

- [ ] Gateway: `pnpm test` (all green, incl. manifest, flows-nodes, trigger-manager, flow-example).
- [ ] Runtime: `npm test && npm run typecheck` (compile-flow plugin tests green).
- [ ] Hub: `bun run check && bun run test`.
- [ ] Manual E2E (if gateway runnable): flow-example trigger + action visible in palette; promptBox→pluginAction run returns `echo:`; activate a pluginTrigger→llm flow, fire `flow-example:ping`, observe run. If not runnable, state so.
- [ ] Dispatch a final cross-repo code review (subagent-driven-development final reviewer).

---

## Notes for the Executor

- **Do not bump `@minion-stack/db` or any package version** — Changesets owns versioning (a prior manual bump was reverted).
- **Commit scope**: stage only the files named per task; never `git add -A`.
- **Branches**: gateway `DEV`, runtime `dev` (meta-repo), hub `dev`. Do not switch/merge branches.
- **Push is currently blocked** (SSH identity); commits stay local. Do not attempt to push.
- **Svelte work**: use the svelte MCP autofixer / svelte-file-editor on `.svelte` files (Svelte 5 runes only).
- Registry/manifest field-name confirmations (Tasks 2, 5, 6) require reading `src/plugins/registry.ts` — do this before implementing rather than guessing.
