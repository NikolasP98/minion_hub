# Agent Artifacts Foundation (Phase 1) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the artifact rendering foundation + design spec, proven with one reference "Agent Overview" artifact embedded on a new autonomous-agent detail page.

**Architecture:** A pure types module (`src/lib/agents/artifacts.ts`), a built-in code registry (`src/lib/server/artifacts/registry.ts`) composing data from the existing system-agent registry, a hub route serving the artifact bundle from a Vite `?raw` import, a context API, an `ArtifactHost` Svelte component that mounts the existing `mountHostBridge` directly (reusing the bridge layer, NOT `PluginIframe`), and a `/agents/autonomous/[id]` detail route.

**Tech Stack:** SvelteKit 2, Svelte 5 (runes), TypeScript (strict), Tailwind 4, Paraglide i18n, Vitest, Bun. Reuses `@nikolasp98/plugin-ui-bridge` + `mountHostBridge` (`$lib/plugins/bridge-host`).

## Global Constraints

- Svelte 5 runes only (`$props()`, `$derived`, `$state`, `onMount`, `onclick={}`). No legacy Svelte 4.
- TypeScript strict; no `any`; never `@ts-nocheck`.
- i18n: every user-facing string in BOTH `messages/en.json` and `messages/es.json`. After editing messages run `bun run i18n:compile` so `m.*` resolves before `bun run check`.
- Server-only code under `$lib/server`/`$server` is never imported by client `.svelte`/pure modules.
- Verify: `bun run check` clean; `bun run test` green. Commits UNSIGNED (`git -c commit.gpgsign=false`). Never `git add` a lockfile.
- Reuse the BRIDGE layer (`mountHostBridge`), do NOT modify `PluginIframe.svelte`.
- Artifacts are token-bound: never hardcode colors; bind to the `tokens` delivered over the bridge.

## Reference: existing types this plan consumes

From `src/lib/agents/autonomous.ts` (already merged):
```ts
interface SystemAgentStatus { enabled: boolean; state: 'active'|'disabled'|'attention'; stats?: { sent: number; failed: number; skipped: number }; detail?: string }
interface AutonomousAgentVM { id: string; source: 'system'|'gateway'; name: string; role: string; description: string; avatarUrl: string; trigger: string|null; managePath: string|null; status: SystemAgentStatus }
```
From `src/lib/server/system-agents/registry.ts`: `loadSystemAgentVMs(ctx: CoreCtx): Promise<AutonomousAgentVM[]>`.
From `$server/auth/core-ctx`: `requireCoreCtx(locals): Promise<CoreCtx>` (throws 401).
From `$lib/plugins/bridge-host`: `mountHostBridge(opts): MountedHostBridge` (opts: `{ self, target, pluginOrigin, hello: { theme, tokens, gatewayUrl, authToken, locale? }, forwardRpc? }`).

---

### Task 1: Pure artifact types + helpers

**Files:**
- Create: `src/lib/agents/artifacts.ts`
- Test: `src/lib/agents/artifacts.test.ts`

**Interfaces — Produces:**
- `interface ArtifactDescriptor { id: string; agentId: string; slot: 'detail'; title: string; kind: 'static'; entrypoint: string }`
- `interface ArtifactContext { agentId: string; agentName: string; agentRole: string; agentDescription: string; status: SystemAgentStatus; trigger: string | null }`
- `function overviewDescriptorFor(agentId: string, title: string): ArtifactDescriptor`
- `function agentVmToArtifactContext(vm: AutonomousAgentVM): ArtifactContext`
- `function artifactSrc(descriptor: ArtifactDescriptor, origin: string): string`

- [ ] **Step 1: Write the failing test** — `src/lib/agents/artifacts.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  overviewDescriptorFor,
  agentVmToArtifactContext,
  artifactSrc,
  type ArtifactDescriptor,
} from './artifacts';
import type { AutonomousAgentVM } from './autonomous';

describe('overviewDescriptorFor', () => {
  it('builds the overview descriptor for an agent', () => {
    expect(overviewDescriptorFor('scheduling.reminders', 'Overview')).toEqual({
      id: 'overview',
      agentId: 'scheduling.reminders',
      slot: 'detail',
      title: 'Overview',
      kind: 'static',
      entrypoint: 'index.html',
    });
  });
});

describe('agentVmToArtifactContext', () => {
  it('maps a VM into artifact context', () => {
    const vm: AutonomousAgentVM = {
      id: 'scheduling.reminders',
      source: 'system',
      name: 'Reminders',
      role: 'Appointment Reminders',
      description: 'Sends reminders.',
      avatarUrl: 'https://x/y',
      trigger: 'On booking',
      managePath: '/scheduling/reminders',
      status: { enabled: true, state: 'active', stats: { sent: 5, failed: 0, skipped: 1 } },
    };
    expect(agentVmToArtifactContext(vm)).toEqual({
      agentId: 'scheduling.reminders',
      agentName: 'Reminders',
      agentRole: 'Appointment Reminders',
      agentDescription: 'Sends reminders.',
      status: vm.status,
      trigger: 'On booking',
    });
  });
});

describe('artifactSrc', () => {
  it('builds a same-origin /artifacts URL with the hostOrigin hash', () => {
    const d: ArtifactDescriptor = { id: 'overview', agentId: 'a', slot: 'detail', title: 'Overview', kind: 'static', entrypoint: 'index.html' };
    expect(artifactSrc(d, 'https://hub.example.com')).toBe(
      'https://hub.example.com/artifacts/overview/ui/index.html#hostOrigin=https%3A%2F%2Fhub.example.com',
    );
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `bun run test -- src/lib/agents/artifacts.test.ts`
Expected: FAIL — module `./artifacts` not found.

- [ ] **Step 3: Implement** — `src/lib/agents/artifacts.ts`:

```ts
import type { AutonomousAgentVM, SystemAgentStatus } from './autonomous';

export interface ArtifactDescriptor {
  id: string;          // bundle id, unique among artifact bundles (e.g. "overview")
  agentId: string;     // owning agent id (e.g. "scheduling.reminders")
  slot: 'detail';      // render surface (phase 1: the agent detail page)
  title: string;       // shown in the host shell header
  kind: 'static';      // 'live' reserved for later
  entrypoint: string;  // bundle path, e.g. "index.html"
}

export interface ArtifactContext {
  agentId: string;
  agentName: string;
  agentRole: string;
  agentDescription: string;
  status: SystemAgentStatus;
  trigger: string | null;
}

/** The built-in "overview" artifact, attached to any agent. `title` is localized by the caller. */
export function overviewDescriptorFor(agentId: string, title: string): ArtifactDescriptor {
  return { id: 'overview', agentId, slot: 'detail', title, kind: 'static', entrypoint: 'index.html' };
}

export function agentVmToArtifactContext(vm: AutonomousAgentVM): ArtifactContext {
  return {
    agentId: vm.id,
    agentName: vm.name,
    agentRole: vm.role,
    agentDescription: vm.description,
    status: vm.status,
    trigger: vm.trigger,
  };
}

/** Same-origin iframe src: the hub serves both the page and the artifact bundle. */
export function artifactSrc(descriptor: ArtifactDescriptor, origin: string): string {
  return `${origin}/artifacts/${descriptor.id}/ui/${descriptor.entrypoint}#hostOrigin=${encodeURIComponent(origin)}`;
}
```

- [ ] **Step 4: Run test, verify it passes** — `bun run test -- src/lib/agents/artifacts.test.ts` → PASS.

- [ ] **Step 5: Commit**
```bash
git add src/lib/agents/artifacts.ts src/lib/agents/artifacts.test.ts
git -c commit.gpgsign=false commit -m "feat(artifacts): pure artifact types + helpers"
```

---

### Task 2: Artifact design spec doc

**Files:**
- Create: `docs/artifacts/DESIGN-SPEC.md`

> No test — it is the written contract the reference artifact (Task 5) implements. Verified by existence + the reference artifact conforming.

- [ ] **Step 1: Write the spec** — `docs/artifacts/DESIGN-SPEC.md`:

```markdown
# Artifact Design Spec

An **artifact** is a sandboxed visual surface owned by an agent, embedded in the
hub via an iframe + the plugin-ui bridge. Every artifact MUST follow this spec
so all agents' artifacts feel consistent.

## Runtime contract
- The artifact is a self-contained bundle served by the hub at
  `/artifacts/<id>/ui/<path>`. Entry: `index.html`.
- It speaks the `@nikolasp98/plugin-ui-bridge` postMessage protocol:
  1. On load, read the host origin from `location.hash` (`#hostOrigin=<encoded>`).
  2. `postMessage({ type: 'plugin:ready', protocolVersion: 1 }, hostOrigin)`.
  3. On `host:hello` → apply `tokens` (set each as a CSS custom property on
     `:root`) and toggle the `dark` class from `theme`.
  4. Fetch data via one RPC: `plugin:rpc-request` with
     `method: 'hub.artifact.context.get'`, no params. The host replies
     `host:rpc-response { id, ok, payload }`.
- The artifact MUST validate `event.origin === hostOrigin` on every inbound message.
- The artifact MUST NOT call any other RPC method and MUST NOT open network
  connections of its own in phase 1 (static kind).

## Visual contract
- **Theme:** colors/spacing/radius come ONLY from the delivered tokens
  (`--color-*`, `--radius`, etc., originating from `@minion-stack/design-tokens`).
  Never hardcode hex colors.
- **Layout:** a single column, max-width 100%, padding `1rem`. A header row
  (agent name + role) at top; sections below.
- **Sections (the four framings):** an artifact should answer, where it has data:
  *What I do* (purpose/description), *How I'm doing* (live status), *What I've
  done* (activity totals), *How I work* (trigger/cadence). Use `<section>` with
  an `<h2>` label per framing.
- **States:** render an explicit **loading** state until `host:hello` + context
  arrive, and an **error** state if the context RPC fails.
- **Sizing:** fill the host container width; the host owns height (fill mode).

## Out of scope (later)
Live (WS/WebRTC) artifacts, charts beyond simple token-styled stat cards, and
user-authored artifacts (the builder agent).
```

- [ ] **Step 2: Commit**
```bash
git add docs/artifacts/DESIGN-SPEC.md
git -c commit.gpgsign=false commit -m "docs(artifacts): artifact design spec contract"
```

---

### Task 3: Built-in artifact registry

**Files:**
- Create: `src/lib/server/artifacts/registry.ts`
- Modify: `messages/en.json`, `messages/es.json` (artifact title key)

**Interfaces:**
- Consumes: `loadSystemAgentVMs` (`$lib/server/system-agents/registry`); `overviewDescriptorFor`, `agentVmToArtifactContext`, `ArtifactDescriptor`, `ArtifactContext` (`$lib/agents/artifacts`); `CoreCtx` (`$server/auth/core-ctx`); `m` (paraglide).
- Produces: `getArtifactsForAgent(agentId: string): ArtifactDescriptor[]`; `getArtifactContext(ctx: CoreCtx, agentId: string, artifactId: string): Promise<ArtifactContext | null>`.

> No unit test (DB-orchestration glue; the pure mapping is tested in Task 1). Verified by `bun run check`.

- [ ] **Step 1: Add i18n key** — in `messages/en.json`: `"artifact_overview_title": "Overview",` ; in `messages/es.json`: `"artifact_overview_title": "Resumen",`.

- [ ] **Step 2: Write the registry** — `src/lib/server/artifacts/registry.ts`:

```ts
import type { CoreCtx } from '$server/auth/core-ctx';
import { loadSystemAgentVMs } from '$lib/server/system-agents/registry';
import {
  overviewDescriptorFor,
  agentVmToArtifactContext,
  type ArtifactDescriptor,
  type ArtifactContext,
} from '$lib/agents/artifacts';
import * as m from '$lib/paraglide/messages';

/** Built-in artifacts for an agent. Phase 1: every agent gets the Overview. */
export function getArtifactsForAgent(agentId: string): ArtifactDescriptor[] {
  return [overviewDescriptorFor(agentId, m.artifact_overview_title())];
}

/** Resolve a (agentId, artifactId) instance's data, or null if unknown. */
export async function getArtifactContext(
  ctx: CoreCtx,
  agentId: string,
  artifactId: string,
): Promise<ArtifactContext | null> {
  if (artifactId !== 'overview') return null;
  const vms = await loadSystemAgentVMs(ctx);
  const vm = vms.find((v) => v.id === agentId);
  return vm ? agentVmToArtifactContext(vm) : null;
}
```

- [ ] **Step 3: Verify** — `bun run i18n:compile && bun run check` → 0 errors.

- [ ] **Step 4: Commit**
```bash
git add src/lib/server/artifacts/registry.ts messages/en.json messages/es.json
git -c commit.gpgsign=false commit -m "feat(artifacts): built-in artifact registry"
```

---

### Task 4: Artifact context API route

**Files:**
- Create: `src/routes/api/artifacts/[id]/context/+server.ts`

**Interfaces:**
- Consumes: `requireCoreCtx` (`$server/auth/core-ctx`); `getArtifactContext` (`$lib/server/artifacts/registry`).
- Produces: `GET /api/artifacts/<id>/context?agentId=<agentId>` → `ArtifactContext` JSON (404 if null).

> No unit test (route glue + auth). Verified by `bun run check` + live.

- [ ] **Step 1: Write the route** — `src/routes/api/artifacts/[id]/context/+server.ts`:

```ts
import type { RequestHandler } from './$types';
import { error, json } from '@sveltejs/kit';
import { requireCoreCtx } from '$server/auth/core-ctx';
import { getArtifactContext } from '$lib/server/artifacts/registry';

export const GET: RequestHandler = async ({ locals, params, url }) => {
  const ctx = await requireCoreCtx(locals); // throws 401 if unauthenticated
  const agentId = url.searchParams.get('agentId');
  if (!agentId) throw error(400, 'agentId required');
  const context = await getArtifactContext(ctx, agentId, params.id);
  if (!context) throw error(404, 'artifact context not found');
  return json(context);
};
```

> Note: `/api/` routes are gated by `hooks.server.ts`. This route requires an authenticated user session (artifacts render inside the authenticated app), so the default 401-for-unauthenticated-`/api/` behavior is correct — no hooks bypass needed.

- [ ] **Step 2: Verify** — `bun run check` → clean.

- [ ] **Step 3: Commit**
```bash
git add "src/routes/api/artifacts/[id]/context/+server.ts"
git -c commit.gpgsign=false commit -m "feat(artifacts): artifact context API route"
```

---

### Task 5: Reference artifact bundle (Agent Overview)

**Files:**
- Create: `src/lib/artifacts/builtin/overview/index.html`

> No unit test (static asset). Implements `docs/artifacts/DESIGN-SPEC.md`; validated live in Task 10.

- [ ] **Step 1: Write the bundle** — `src/lib/artifacts/builtin/overview/index.html` (self-contained: token-bound CSS + vanilla bridge client):

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Agent Overview</title>
  <style>
    :root { color-scheme: light dark; }
    * { box-sizing: border-box; }
    body {
      margin: 0; padding: 1rem;
      font-family: system-ui, -apple-system, sans-serif;
      background: var(--color-background, #0b0b0f);
      color: var(--color-foreground, #e7e7ea);
    }
    .hdr { display: flex; align-items: center; gap: .75rem; margin-bottom: 1rem; }
    .hdr h1 { font-size: 1rem; margin: 0; }
    .hdr p { font-size: .8rem; margin: .1rem 0 0; opacity: .6; }
    .pill { margin-left: auto; font-size: .7rem; padding: .15rem .5rem; border-radius: 999px;
      border: 1px solid var(--color-border, #2a2a31); }
    .pill.active { color: #34d399; border-color: #34d39955; }
    .pill.attention { color: #fbbf24; border-color: #fbbf2455; }
    .pill.disabled { opacity: .5; }
    section { border: 1px solid var(--color-border, #2a2a31); border-radius: var(--radius, 12px);
      padding: .75rem .9rem; margin-bottom: .6rem; background: var(--color-card, transparent); }
    section h2 { font-size: .72rem; text-transform: uppercase; letter-spacing: .04em;
      opacity: .55; margin: 0 0 .35rem; }
    section p { margin: 0; font-size: .85rem; line-height: 1.4; }
    .stats { display: flex; gap: 1rem; }
    .stat b { display: block; font-size: 1.1rem; }
    .stat span { font-size: .72rem; opacity: .55; }
    #state { font-size: .85rem; opacity: .6; }
    [hidden] { display: none !important; }
  </style>
</head>
<body>
  <div id="state">Loading…</div>
  <main id="app" hidden>
    <div class="hdr">
      <div>
        <h1 id="name"></h1>
        <p id="role"></p>
      </div>
      <span id="pill" class="pill"></span>
    </div>
    <section><h2>What I do</h2><p id="desc"></p></section>
    <section><h2>How I'm doing</h2><p id="how"></p></section>
    <section><h2>What I've done</h2><div class="stats" id="stats"></div></section>
    <section><h2>How I work</h2><p id="trigger"></p></section>
  </main>
  <script>
    (function () {
      var hostOrigin = new URLSearchParams(location.hash.slice(1)).get('hostOrigin');
      var rpcId = 0, pending = {};
      function applyTokens(theme, tokens) {
        if (tokens) for (var k in tokens) document.documentElement.style.setProperty(k, tokens[k]);
        document.documentElement.classList.toggle('dark', theme === 'dark');
      }
      function call(method) {
        return new Promise(function (resolve, reject) {
          var id = 'rpc-' + ++rpcId;
          pending[id] = { resolve: resolve, reject: reject };
          parent.postMessage({ type: 'plugin:rpc-request', id: id, method: method, params: {} }, hostOrigin);
        });
      }
      function render(c) {
        document.getElementById('state').hidden = true;
        document.getElementById('app').hidden = false;
        document.getElementById('name').textContent = c.agentName || '';
        document.getElementById('role').textContent = c.agentRole || '';
        document.getElementById('desc').textContent = c.agentDescription || '—';
        var st = (c.status && c.status.state) || 'disabled';
        var pill = document.getElementById('pill');
        pill.textContent = st;
        pill.className = 'pill ' + st;
        document.getElementById('how').textContent =
          (c.status && c.status.detail) ? c.status.detail :
          st === 'active' ? 'Running normally.' : st === 'attention' ? 'Needs attention.' : 'Disabled.';
        var s = (c.status && c.status.stats) || null;
        document.getElementById('stats').innerHTML = s
          ? '<div class="stat"><b>' + s.sent + '</b><span>sent</span></div>' +
            '<div class="stat"><b>' + s.failed + '</b><span>failed</span></div>' +
            '<div class="stat"><b>' + s.skipped + '</b><span>skipped</span></div>'
          : '<span style="opacity:.55;font-size:.8rem">No activity yet.</span>';
        document.getElementById('trigger').textContent = c.trigger || '—';
      }
      function fail(msg) {
        var el = document.getElementById('state');
        el.hidden = false;
        el.textContent = 'Could not load: ' + msg;
      }
      window.addEventListener('message', function (ev) {
        if (ev.origin !== hostOrigin) return;
        var d = ev.data || {};
        if (d.type === 'host:hello') {
          applyTokens(d.theme, d.tokens);
          call('hub.artifact.context.get').then(render).catch(function (e) { fail(String(e)); });
        } else if (d.type === 'host:rpc-response') {
          var p = pending[d.id];
          if (!p) return;
          delete pending[d.id];
          if (d.ok) p.resolve(d.payload); else p.reject(new Error((d.error && d.error.message) || 'rpc failed'));
        }
      });
      if (!hostOrigin) { fail('no host origin'); return; }
      parent.postMessage({ type: 'plugin:ready', protocolVersion: 1 }, hostOrigin);
    })();
  </script>
</body>
</html>
```

- [ ] **Step 2: Commit**
```bash
git add src/lib/artifacts/builtin/overview/index.html
git -c commit.gpgsign=false commit -m "feat(artifacts): reference Agent Overview artifact bundle"
```

---

### Task 6: Artifact bundle serving route

**Files:**
- Create: `src/routes/artifacts/[artifactId]/ui/[...path]/+server.ts`

**Interfaces:**
- Produces: `GET /artifacts/<artifactId>/ui/<...path>` → the bundle file with `frame-ancestors 'self'`. 404 for unknown bundle/path.

> No unit test (asset glue). Verified by `bun run check` + live. Serves from a Vite `?raw` import (bundled at build — production-safe, no runtime fs, no path traversal since it's a map lookup).

- [ ] **Step 1: Write the route** — `src/routes/artifacts/[artifactId]/ui/[...path]/+server.ts`:

```ts
import type { RequestHandler } from './$types';
import { error } from '@sveltejs/kit';
import overviewHtml from '$lib/artifacts/builtin/overview/index.html?raw';

// Built-in artifact bundles, imported at build time (no runtime fs). Map lookup
// means there is no path-traversal surface.
const BUNDLES: Record<string, Record<string, { body: string; type: string }>> = {
  overview: {
    'index.html': { body: overviewHtml, type: 'text/html; charset=utf-8' },
  },
};

export const GET: RequestHandler = ({ params }) => {
  const file = BUNDLES[params.artifactId]?.[params.path];
  if (!file) throw error(404, 'artifact asset not found');
  return new Response(file.body, {
    headers: {
      'content-type': file.type,
      // Only the hub may embed artifacts.
      'content-security-policy': "frame-ancestors 'self'",
      'cache-control': 'no-store',
    },
  });
};
```

- [ ] **Step 2: Verify** — `bun run check`.
  Expected: clean. **If** check errors on the `?raw` import type, add to `src/app.d.ts` inside the global block (or a new `src/vite-raw.d.ts`):
  ```ts
  declare module '*?raw' { const content: string; export default content; }
  ```
  then re-run `bun run check`.

- [ ] **Step 3: Commit**
```bash
git add "src/routes/artifacts/[artifactId]/ui/[...path]/+server.ts" src/app.d.ts 2>/dev/null; git add "src/routes/artifacts/[artifactId]/ui/[...path]/+server.ts"
git -c commit.gpgsign=false commit -m "feat(artifacts): hub serving route for artifact bundles"
```

---

### Task 7: ArtifactHost component

**Files:**
- Create: `src/lib/components/artifacts/ArtifactHost.svelte`

**Interfaces:**
- Consumes: `mountHostBridge`, `MountedHostBridge` (`$lib/plugins/bridge-host`); `artifactSrc`, `ArtifactDescriptor` (`$lib/agents/artifacts`); `m`.
- Produces: `<ArtifactHost descriptor={d} />`.

> No unit test (iframe/bridge glue). Validated live (Task 10). The bridge protocol + context mapping are exercised by Task 1 tests + the live render.

- [ ] **Step 1: Write the component** — `src/lib/components/artifacts/ArtifactHost.svelte`:

```svelte
<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { mountHostBridge, type MountedHostBridge } from '$lib/plugins/bridge-host';
  import { artifactSrc, type ArtifactDescriptor } from '$lib/agents/artifacts';

  let { descriptor }: { descriptor: ArtifactDescriptor } = $props();

  let iframeEl = $state<HTMLIFrameElement | null>(null);
  let mounted: MountedHostBridge | null = null;
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const src = $derived(origin ? artifactSrc(descriptor, origin) : '');

  // Snapshot the hub's CSS custom properties + theme so the artifact themes to match.
  function snapshot(): { theme: 'light' | 'dark'; tokens: Record<string, string> } {
    const tokens: Record<string, string> = {};
    const rootStyle = document.documentElement.style;
    for (let i = 0; i < rootStyle.length; i++) {
      const k = rootStyle[i];
      if (k.startsWith('--')) tokens[k] = rootStyle.getPropertyValue(k);
    }
    for (const sheet of Array.from(document.styleSheets)) {
      let rules: CSSRuleList;
      try { rules = sheet.cssRules; } catch { continue; }
      for (const rule of Array.from(rules)) {
        if (rule instanceof CSSStyleRule && rule.selectorText === ':root') {
          for (let i = 0; i < rule.style.length; i++) {
            const k = rule.style[i];
            if (k.startsWith('--') && !(k in tokens)) tokens[k] = rule.style.getPropertyValue(k);
          }
        }
      }
    }
    return { theme: document.documentElement.classList.contains('dark') ? 'dark' : 'light', tokens };
  }

  // Artifact data: answer hub.artifact.context.get from the hub API; reject anything else.
  async function forwardRpc(method: string): Promise<unknown> {
    if (method !== 'hub.artifact.context.get') throw new Error(`artifact rpc not allowed: ${method}`);
    const res = await fetch(
      `/api/artifacts/${descriptor.id}/context?agentId=${encodeURIComponent(descriptor.agentId)}`,
      { credentials: 'same-origin' },
    );
    if (!res.ok) throw new Error(`context ${res.status}`);
    return res.json();
  }

  onMount(() => {
    if (!iframeEl?.contentWindow) return;
    const { theme, tokens } = snapshot();
    mounted = mountHostBridge({
      self: window,
      target: iframeEl.contentWindow,
      pluginOrigin: origin,
      hello: { theme, tokens, gatewayUrl: '', authToken: '' },
      forwardRpc: (method) => forwardRpc(method),
    });
  });

  onDestroy(() => mounted?.dispose());
</script>

<div class="flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-white/10 bg-white/[0.02]">
  <div class="flex items-center gap-2 border-b border-white/10 px-3 py-2 text-xs font-medium text-white/70">
    {descriptor.title}
  </div>
  {#if src}
    <iframe
      bind:this={iframeEl}
      {src}
      title={descriptor.title}
      referrerpolicy="strict-origin"
      class="min-h-0 w-full flex-1 border-0"
    ></iframe>
  {/if}
</div>
```

- [ ] **Step 2: Validate Svelte** — load the Svelte MCP autofixer (ToolSearch `select:mcp__plugin_svelte_svelte__svelte-autofixer`), run it on this component, apply correctness fixes. Then `bun run check` → clean.

- [ ] **Step 3: Commit**
```bash
git add src/lib/components/artifacts/ArtifactHost.svelte
git -c commit.gpgsign=false commit -m "feat(artifacts): ArtifactHost (bridge mount + shell)"
```

---

### Task 8: Autonomous agent detail route

**Files:**
- Create: `src/routes/(app)/agents/autonomous/[id]/+page.server.ts`
- Create: `src/routes/(app)/agents/autonomous/[id]/+page.svelte`
- Modify: `messages/en.json`, `messages/es.json` (detail strings)

**Interfaces:**
- Consumes: `requireCoreCtx`; `loadSystemAgentVMs`; `getArtifactsForAgent` (`$lib/server/artifacts/registry`); `ArtifactHost`; `AutonomousAgentVM`, `ArtifactDescriptor`; `m`.
- Produces: page at `/agents/autonomous/<id>`.

> No unit test (route glue). Validated live (Task 10).

- [ ] **Step 1: Add i18n keys** — `messages/en.json`: `"autonomous_detail_back": "Back to autonomous agents",` `"autonomous_detail_manage": "Open settings",` ; `messages/es.json`: `"autonomous_detail_back": "Volver a agentes autónomos",` `"autonomous_detail_manage": "Abrir ajustes",`.

- [ ] **Step 2: Write the load** — `src/routes/(app)/agents/autonomous/[id]/+page.server.ts`:

```ts
import type { PageServerLoad } from './$types';
import { error } from '@sveltejs/kit';
import { requireCoreCtx } from '$server/auth/core-ctx';
import { loadSystemAgentVMs } from '$lib/server/system-agents/registry';
import { getArtifactsForAgent } from '$lib/server/artifacts/registry';

export const load: PageServerLoad = async ({ locals, params }) => {
  const ctx = await requireCoreCtx(locals);
  const vms = await loadSystemAgentVMs(ctx).catch(() => []);
  const agent = vms.find((v) => v.id === params.id);
  if (!agent) throw error(404, 'Agent not found');
  return { agent, artifacts: getArtifactsForAgent(agent.id) };
};
```

- [ ] **Step 3: Write the page** — `src/routes/(app)/agents/autonomous/[id]/+page.svelte`:

```svelte
<script lang="ts">
  import * as m from '$lib/paraglide/messages';
  import { ArrowLeft, Settings2, Zap } from 'lucide-svelte';
  import ArtifactHost from '$lib/components/artifacts/ArtifactHost.svelte';
  import type { AutonomousAgentVM, ArtifactDescriptor } from '$lib/agents/artifacts';

  let { data }: { data: { agent: AutonomousAgentVM; artifacts: ArtifactDescriptor[] } } = $props();
  const agent = $derived(data.agent);
</script>

<div class="flex h-full flex-col overflow-hidden p-6">
  <a href="/agents/autonomous" class="mb-4 inline-flex items-center gap-1.5 text-xs text-white/50 hover:text-white/80">
    <ArrowLeft size={13} /> {m.autonomous_detail_back()}
  </a>

  <header class="mb-5 flex items-start gap-3">
    <img src={agent.avatarUrl} alt="" class="size-12 shrink-0 rounded-lg bg-white/5 ring-1 ring-white/10" />
    <div class="min-w-0 flex-1">
      <h1 class="text-lg font-semibold text-white">{agent.name}</h1>
      {#if agent.role}<p class="text-sm text-white/50">{agent.role}</p>{/if}
      {#if agent.trigger}
        <p class="mt-1 inline-flex items-center gap-1.5 text-[11px] text-white/45"><Zap size={12} /> {agent.trigger}</p>
      {/if}
    </div>
    {#if agent.managePath}
      <a href={agent.managePath} class="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1 text-xs font-medium text-white/80 hover:bg-white/10">
        <Settings2 size={13} /> {m.autonomous_detail_manage()}
      </a>
    {/if}
  </header>

  <div class="grid min-h-0 flex-1 grid-cols-1 gap-3">
    {#each data.artifacts as artifact (artifact.id)}
      <div class="min-h-[24rem]">
        <ArtifactHost descriptor={artifact} />
      </div>
    {/each}
  </div>
</div>
```

- [ ] **Step 4: Validate Svelte** — run the Svelte MCP autofixer on the page; apply correctness fixes. `bun run i18n:compile && bun run check` → clean.

- [ ] **Step 5: Commit**
```bash
git add "src/routes/(app)/agents/autonomous/[id]/+page.server.ts" "src/routes/(app)/agents/autonomous/[id]/+page.svelte" messages/en.json messages/es.json
git -c commit.gpgsign=false commit -m "feat(artifacts): autonomous agent detail route with artifact slot"
```

---

### Task 9: Route the autonomous card to the detail page

**Files:**
- Modify: `src/lib/components/agents/AutonomousAgentCard.svelte`

**Interfaces:**
- The card's primary click/Manage now navigates to `/agents/autonomous/<agent.id>` (the detail page) rather than directly to `managePath`. (The detail page still surfaces `managePath` as "Open settings".)

> No unit test (presentational). Validated live (Task 10).

- [ ] **Step 1: Read the current card** to find the Manage button (added in the autonomous-agents work): it currently does `onclick={() => goto(agent.managePath!)}` guarded by `{#if agent.managePath}`.

- [ ] **Step 2: Change the navigation target** — make the whole card open the detail page. Replace the Manage `<button>`'s handler target and drop the `managePath` guard so every agent (system or gateway) opens its detail page:

```svelte
<button
  type="button"
  onclick={() => goto(`/agents/autonomous/${encodeURIComponent(agent.id)}`)}
  class="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1 text-xs font-medium text-white/80 transition-colors hover:bg-white/10"
>
  <Settings2 size={13} />
  {m.autonomous_manage()}
</button>
```

(Keep the existing `goto` import and `Settings2`/`m.autonomous_manage` usage. Remove the now-unnecessary `{#if agent.managePath}` wrapper around this button so it always renders.)

- [ ] **Step 3: Validate Svelte + check** — Svelte MCP autofixer on the card; `bun run check` → clean.

- [ ] **Step 4: Commit**
```bash
git add src/lib/components/agents/AutonomousAgentCard.svelte
git -c commit.gpgsign=false commit -m "feat(artifacts): autonomous card opens the agent detail page"
```

---

### Task 10: Full verification

**Files:** none.

- [ ] **Step 1: Type-check** — `bun run i18n:compile && bun run check` → 0 errors / 0 warnings. Fix any new error in the files above.

- [ ] **Step 2: Tests** — `bun run test` → green; the new `artifacts.test.ts` passes; total otherwise unchanged.

- [ ] **Step 3: Live check (best-effort)** — if a dev server with DB connectivity is available, sign in (FACES admin), open `/agents/autonomous` → click the Reminders agent → confirm `/agents/autonomous/scheduling.reminders` renders the header + an embedded **Agent Overview** artifact themed to the hub, showing role, status pill (Active), trigger, and stats; the artifact loads its data via the bridge (no console errors), served under `frame-ancestors 'self'`. If no DB-connected dev server is available, note live check as deferred (the worktree dev server cannot reach the Supabase pooler in this environment).

- [ ] **Step 4: Commit any fixes** (only if Steps 1–2 required changes)
```bash
git add -A && git -c commit.gpgsign=false commit -m "chore(artifacts): phase-1 verification fixes"
```

---

## Self-Review

**Spec coverage:** design spec (T2) ✓; built-in registry, no DB (T1 helpers + T3) ✓; serving route + CSP (T6) ✓; ArtifactHost via mountHostBridge, no PluginIframe edit (T7) ✓; data via forwardRpc → context API, artifact calls with no params (T4 + T7 + T5) ✓; `/agents/autonomous/[id]` detail surface (T8) ✓; card routes to detail (T9) ✓; reference Overview artifact, token-bound, 4 framings, loading/error (T5) ✓; i18n en/es (T3, T8) ✓; tests for pure logic (T1) ✓.

**Placeholder scan:** none — every step has complete code or exact commands. The `?raw` ambient-decl fallback (T6) is conditional but concrete.

**Type consistency:** `ArtifactDescriptor`/`ArtifactContext` defined T1, consumed T3/T7/T8. `getArtifactContext(ctx, agentId, artifactId)` T3, called T4. `getArtifactsForAgent(agentId)` T3, called T8. `artifactSrc(descriptor, origin)` T1, used T7. `mountHostBridge` opts match `bridge-host.ts` (`self`, `target`, `pluginOrigin`, `hello{theme,tokens,gatewayUrl,authToken}`, `forwardRpc`). Bridge message shapes in the reference artifact (T5) match the protocol (`plugin:ready`/`plugin:rpc-request` out, `host:hello`/`host:rpc-response` in). Detail route param `[id]` = VM id (e.g. `scheduling.reminders`), consistent with T9's `goto`.
