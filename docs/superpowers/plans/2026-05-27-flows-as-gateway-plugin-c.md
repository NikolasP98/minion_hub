# C — Flows as a Gateway Plugin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the flow editor a real, toggleable gateway plugin (`flows`) that appears in settings/plugins, stays under the **Gateway** nav category (never the Plugins category), and — when disabled — hides from the nav, blocks its route, and stops trigger-based execution.

**Architecture:** A new lightweight `flows` gateway extension (`minion/extensions/flows/`) contributes a `settings.plugins` iframe + a `config.enabled` master switch (default on). The gateway trigger-manager gates firing on that switch. The hub reads each plugin's `configEnabled` from `plugins.ui.list`, drops the static Gateway-section `/flow-editor` item when flows is explicitly disabled, and a `+layout.server.ts` redirects direct visits when disabled. Flows never enters the dynamic Plugins nav section because it declares only the `settings.plugins` slot (that section is built from `plugins.controlCenter` entries only).

**Tech Stack:** Gateway (`minion`, branch `DEV`, pnpm, vitest, TS) — extension manifest/loader, `loadConfig()`, `src/flows/trigger-manager.ts`. Hub (`minion_hub`, branch `dev`, bun, svelte-check, vitest) — `sections.ts`, `plugin-nav.svelte.ts`, SvelteKit `+layout.server.ts`.

**Spec:** `minion_hub/docs/superpowers/specs/2026-05-27-flows-as-gateway-plugin-c-design.md`

**Cross-repo constraints (MUST follow in every task):**
- Named-file `git add` ONLY (never `git add -A`).
- Always `cd` into the repo root in the SAME command as `git commit` (symlink quirk — commit fails otherwise).
- Do NOT push, switch branches, or bump versions.
- `minion` is branch `DEV` (pnpm); `minion_hub` is branch `dev` (bun). They are SEPARATE git repos. `langgraph-server` is NOT touched.
- Hub `bun run check` has 18 KNOWN pre-existing errors in unrelated server/service/route files — the bar is "no NEW error in files this task touches."

---

## File Structure

**Gateway (`minion`, `DEV`):**
- Create: `extensions/flows/minion.plugin.json` — plugin manifest (id `flows`, `settings.plugins` UI, `configSchema.enabled`).
- Create: `extensions/flows/index.ts` — no-op `MinionPluginDefinition` (identity only).
- Create: `extensions/flows/ui/dist/index.html` — static settings iframe page.
- Create: `extensions/flows/minion.plugin.test.ts` — manifest-shape unit test.
- Modify: `src/flows/trigger-manager.ts` — add `isFlowsPluginEnabled()` + gate `handleTriggerEvent`.
- Modify/Create test: `src/flows/trigger-manager.test.ts` (or the existing flows test file) — gate behavior.

**Hub (`minion_hub`, `dev`):**
- Modify: `src/lib/state/plugin-nav.svelte.ts` — add `enabledByPluginId` + populate it.
- Modify: `src/lib/components/layout/sections.ts` — add `isFlowsNavVisible()` + `gateSections()` helpers.
- Modify: `src/lib/components/layout/Topbar.svelte`, `src/lib/components/layout/SectionSwitcher.svelte`, `src/lib/components/layout/CommandPalette.svelte` — apply the gate.
- Modify: `src/lib/state/plugin-nav.test.ts` — assert `enabledByPluginId`.
- Create: `src/lib/components/layout/sections.test.ts` — `isFlowsNavVisible`/`gateSections` unit tests.
- Create: `src/routes/(app)/flow-editor/+layout.server.ts` — route guard.
- Create: `src/lib/server/flows-gate.ts` + `src/lib/server/flows-gate.test.ts` — `shouldBlockFlowEditor()` predicate (testable without a SvelteKit harness).

---

## Task 1: Gateway — `flows` extension scaffold

**Files:**
- Create: `extensions/flows/minion.plugin.json`
- Create: `extensions/flows/index.ts`
- Create: `extensions/flows/ui/dist/index.html`
- Create: `extensions/flows/minion.plugin.test.ts`

- [ ] **Step 1: Write the failing manifest test**

Create `extensions/flows/minion.plugin.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const manifest = JSON.parse(
  readFileSync(fileURLToPath(new URL('./minion.plugin.json', import.meta.url)), 'utf8'),
);

describe('flows plugin manifest', () => {
  it('has id "flows"', () => {
    expect(manifest.id).toBe('flows');
  });
  it('declares a settings.plugins UI and no controlCenter slot', () => {
    const slots = (manifest.ui ?? []).map((u: { slot: string }) => u.slot);
    expect(slots).toContain('settings.plugins');
    expect(slots).not.toContain('plugins.controlCenter');
  });
  it('settings UI entrypoint points at the static dist page', () => {
    const ui = (manifest.ui ?? []).find((u: { slot: string }) => u.slot === 'settings.plugins');
    expect(ui.entrypoint).toBe('ui/dist/index.html');
  });
  it('configSchema exposes an enabled boolean', () => {
    expect(manifest.configSchema?.properties?.enabled?.type).toBe('boolean');
  });
});
```

- [ ] **Step 2: Run it, verify FAIL**

Run: `cd /home/nikolas/Documents/CODE/MINION/minion && npx vitest run extensions/flows/minion.plugin.test.ts`
Expected: FAIL — `minion.plugin.json` does not exist (ENOENT).

- [ ] **Step 3: Create the manifest**

Create `extensions/flows/minion.plugin.json`:
```json
{
  "id": "flows",
  "name": "Flows",
  "description": "Visual flow automation — triggers, agents, and graph nodes wired in the flow editor.",
  "configSchema": {
    "type": "object",
    "additionalProperties": true,
    "properties": {
      "enabled": { "type": "boolean", "description": "Master switch for the flow editor and trigger execution." }
    }
  },
  "ui": [
    {
      "slot": "settings.plugins",
      "title": "Flows",
      "description": "Enable the flow editor and trigger-based flow execution.",
      "entrypoint": "ui/dist/index.html",
      "icon": "GitBranch"
    }
  ]
}
```

- [ ] **Step 4: Create the no-op plugin entry**

FIRST read `extensions/flow-example/index.ts` to confirm the exact `MinionPluginDefinition` import path + `register` signature, then create `extensions/flows/index.ts` mirroring it:
```ts
import type { MinionPluginApi, MinionPluginDefinition } from "../../src/plugins/types.js";

const plugin: MinionPluginDefinition = {
  id: "flows",
  register(_api: MinionPluginApi) {
    // No gateway methods/hooks/channels. Flow execution is handled by the
    // built-in src/flows/ trigger-manager; this plugin provides identity, the
    // settings.plugins UI, and the enable/disable master switch (config.enabled).
  },
};

export default plugin;
```
(If `flow-example` imports these types from a different path or uses a slightly different definition shape, MATCH IT exactly.)

- [ ] **Step 5: Create the static settings iframe page**

Create `extensions/flows/ui/dist/index.html` — framework-free, self-contained, theme-neutral (works on light or dark host):
```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Flows</title>
    <style>
      :root { color-scheme: light dark; }
      body {
        margin: 0; padding: 1.25rem;
        font: 14px/1.5 system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
        color: #1f2330; background: transparent;
      }
      @media (prefers-color-scheme: dark) { body { color: #e6e8ef; } }
      h1 { font-size: 1.1rem; margin: 0 0 .5rem; }
      p { margin: 0 0 .75rem; max-width: 48ch; }
      .muted { opacity: .7; }
      code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: .85em; }
    </style>
  </head>
  <body>
    <h1>Flows</h1>
    <p>Flows powers the visual <strong>flow editor</strong> and trigger-based automation.</p>
    <p>Use the <strong>power toggle</strong> above to enable or disable it. When enabled, open the editor from the <strong>Gateway</strong> menu in the sidebar.</p>
    <p class="muted">Disabling Flows hides the editor and stops trigger-based flows from running across the gateway.</p>
  </body>
</html>
```

- [ ] **Step 6: Run the manifest test, verify PASS**

Run: `cd /home/nikolas/Documents/CODE/MINION/minion && npx vitest run extensions/flows/minion.plugin.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 7: Verify the plugin is discovered + surfaces in the UI list**

Run: `cd /home/nikolas/Documents/CODE/MINION/minion && pnpm build 2>&1 | tail -20` (this runs `scripts/build-extensions.ts`, which compiles `extensions/flows/index.ts` → `index.js`).
Expected: build succeeds; `extensions/flows/index.js` is produced (`ls extensions/flows/index.js`). If the build pipeline reports the flows extension by name, confirm no error for it.

If `pnpm build` is too heavy/slow in this environment, instead run the discovery unit path: `cd /home/nikolas/Documents/CODE/MINION/minion && npx vitest run src/plugins` and confirm discovery tests still pass (the new manifest must not break discovery). Report which you ran.

- [ ] **Step 8: Commit**

```bash
cd /home/nikolas/Documents/CODE/MINION/minion
git add extensions/flows/minion.plugin.json extensions/flows/index.ts extensions/flows/ui/dist/index.html extensions/flows/minion.plugin.test.ts
git commit -m "feat(flows-plugin): scaffold flows gateway plugin (manifest + settings UI) (C)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```
(If `pnpm build` produced `extensions/flows/index.js`, also `git add` it ONLY if other extensions' compiled `.js` are tracked — check `git status` and match the repo convention; if compiled `index.js` files are gitignored, do NOT add it.)

---

## Task 2: Gateway — trigger gate on `config.enabled`

**Files:**
- Modify: `src/flows/trigger-manager.ts`
- Test: `src/flows/trigger-manager.test.ts` (create if absent; otherwise append)

- [ ] **Step 1: Read the current code**

Read `src/flows/trigger-manager.ts`. Confirm: `loadConfig` is imported from `../config/io.js` (cached), and `handleTriggerEvent(event, eventKey)` iterates `registry.entries()` and calls `void fireFlow(...)`. Confirm the config type: `loadConfig()` returns `OpenClawConfig` (from `src/config/types.minion.ts`), and the plugins shape is `config.plugins?.entries?.[id]?.config?.enabled` where `entries` is `Record<string, PluginEntryConfig>` and `PluginEntryConfig.config` is `Record<string, unknown>`.

- [ ] **Step 2: Write the failing test**

Create or append `src/flows/trigger-manager.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { isFlowsPluginEnabled } from './trigger-manager.js';
import type { OpenClawConfig } from '../config/types.minion.js';

const cfg = (enabled: boolean | undefined): OpenClawConfig =>
  ({ plugins: { entries: { flows: { config: enabled === undefined ? {} : { enabled } } } } } as unknown as OpenClawConfig);

describe('isFlowsPluginEnabled', () => {
  it('true when config.enabled is true', () => {
    expect(isFlowsPluginEnabled(cfg(true))).toBe(true);
  });
  it('false when config.enabled is false', () => {
    expect(isFlowsPluginEnabled(cfg(false))).toBe(false);
  });
  it('true (default) when the flag is absent', () => {
    expect(isFlowsPluginEnabled(cfg(undefined))).toBe(true);
  });
  it('true (default) when there is no flows entry', () => {
    expect(isFlowsPluginEnabled({ plugins: { entries: {} } } as unknown as OpenClawConfig)).toBe(true);
  });
  it('true (default) when plugins config is absent', () => {
    expect(isFlowsPluginEnabled({} as OpenClawConfig)).toBe(true);
  });
});
```
(If `OpenClawConfig` lives at a different path, fix the import to the real one found in Step 1.)

- [ ] **Step 3: Run it, verify FAIL**

Run: `cd /home/nikolas/Documents/CODE/MINION/minion && npx vitest run src/flows/trigger-manager.test.ts`
Expected: FAIL — `isFlowsPluginEnabled` not exported.

- [ ] **Step 4: Implement the helper + gate**

In `src/flows/trigger-manager.ts`, add the exported helper (place it near the top-level functions):
```ts
import type { OpenClawConfig } from "../config/types.minion.js"; // add if not already imported

/** Flows plugin master switch. Absent flag / entry ⇒ enabled (default-on). */
export function isFlowsPluginEnabled(config: OpenClawConfig): boolean {
  const flag = config.plugins?.entries?.flows?.config?.enabled;
  return typeof flag === "boolean" ? flag : true;
}
```
Then gate `handleTriggerEvent` with an early return BEFORE the `for` loop:
```ts
async function handleTriggerEvent(
  event: InternalHookEvent,
  eventKey: TriggerEventKey,
): Promise<void> {
  if (!isFlowsPluginEnabled(loadConfig())) return;   // flows plugin disabled — skip all trigger firing
  for (const [flowId, reg] of registry.entries()) {
    // ...unchanged...
  }
}
```
(`loadConfig()` is cached, so calling it per event is cheap — matches the existing `fireFlow` comment about cached loads.)

- [ ] **Step 5: Run tests, verify PASS + no regressions**

Run: `cd /home/nikolas/Documents/CODE/MINION/minion && npx vitest run src/flows/ && npx tsc --noEmit`
Expected: `isFlowsPluginEnabled` tests pass; existing flows tests still pass; tsc clean (or no NEW errors).

- [ ] **Step 6: Commit**

```bash
cd /home/nikolas/Documents/CODE/MINION/minion
git add src/flows/trigger-manager.ts src/flows/trigger-manager.test.ts
git commit -m "feat(flows-plugin): gate trigger execution on flows config.enabled (C)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Hub — plugin-nav enabled map + nav-gate helpers

**Files:**
- Modify: `src/lib/state/plugin-nav.svelte.ts`
- Modify: `src/lib/components/layout/sections.ts`
- Modify: `src/lib/state/plugin-nav.test.ts`
- Create: `src/lib/components/layout/sections.test.ts`

- [ ] **Step 1: Write the failing sections test**

Create `src/lib/components/layout/sections.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { isFlowsNavVisible, gateSections, getSections } from './sections';

describe('isFlowsNavVisible', () => {
  it('visible when map is empty (back-compat)', () => {
    expect(isFlowsNavVisible({})).toBe(true);
  });
  it('visible when flows enabled', () => {
    expect(isFlowsNavVisible({ flows: true })).toBe(true);
  });
  it('hidden when flows explicitly disabled', () => {
    expect(isFlowsNavVisible({ flows: false })).toBe(false);
  });
  it('visible when only other plugins are disabled', () => {
    expect(isFlowsNavVisible({ whatsapp: false })).toBe(true);
  });
});

describe('gateSections', () => {
  it('removes the /flow-editor item from Gateway when flows disabled', () => {
    const gated = gateSections(getSections(), { flows: false });
    const gateway = gated.find((s) => s.id === 'gateway');
    expect(gateway?.items.some((i) => i.href === '/flow-editor')).toBe(false);
  });
  it('keeps /flow-editor when flows enabled', () => {
    const gated = gateSections(getSections(), { flows: true });
    const gateway = gated.find((s) => s.id === 'gateway');
    expect(gateway?.items.some((i) => i.href === '/flow-editor')).toBe(true);
  });
  it('keeps every non-flows item untouched', () => {
    const before = getSections().flatMap((s) => s.items.map((i) => i.href)).filter((h) => h !== '/flow-editor');
    const after = gateSections(getSections(), { flows: false }).flatMap((s) => s.items.map((i) => i.href));
    expect(after).toEqual(before);
  });
});
```

- [ ] **Step 2: Run it, verify FAIL**

Run: `cd /home/nikolas/Documents/CODE/MINION/minion_hub && npx vitest run src/lib/components/layout/sections.test.ts`
Expected: FAIL — `isFlowsNavVisible`/`gateSections` not exported.

- [ ] **Step 3: Add the helpers to `sections.ts`**

In `src/lib/components/layout/sections.ts`, add (after `getSections`):
```ts
/** Flows nav item is visible unless an explicit `false` exists for pluginId "flows". */
export function isFlowsNavVisible(enabledByPluginId: Record<string, boolean>): boolean {
  return enabledByPluginId.flows !== false;
}

/**
 * Apply plugin enable-state gates to the static sections. Currently: drops the
 * Gateway-section `/flow-editor` item when the flows plugin is explicitly
 * disabled. Returns new section/item arrays (does not mutate the input).
 */
export function gateSections(
  sections: Section[],
  enabledByPluginId: Record<string, boolean>,
): Section[] {
  const flowsVisible = isFlowsNavVisible(enabledByPluginId);
  if (flowsVisible) return sections;
  return sections.map((s) =>
    s.id === 'gateway'
      ? { ...s, items: s.items.filter((it) => it.href !== '/flow-editor') }
      : s,
  );
}
```

- [ ] **Step 4: Run the sections test, verify PASS**

Run: `cd /home/nikolas/Documents/CODE/MINION/minion_hub && npx vitest run src/lib/components/layout/sections.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing plugin-nav test**

Read `src/lib/state/plugin-nav.test.ts` first to match its harness (it likely mocks `fetch` for `/api/plugins/ui-list`). Append a test asserting `enabledByPluginId` is populated from entries' `configEnabled`:
```ts
it('populates enabledByPluginId from configEnabled (absent ⇒ true)', async () => {
  // Arrange a fetch mock returning entries with mixed configEnabled, matching
  // the existing test's mocking style for /api/plugins/ui-list. Entries:
  //   { pluginId: 'flows', slot: 'settings.plugins', configEnabled: false, ... }
  //   { pluginId: 'whatsapp', slot: 'settings.plugins', /* configEnabled absent */ ... }
  // Act: reset pluginNavState.loaded = false; await hydratePluginNav();
  // Assert:
  expect(pluginNavState.enabledByPluginId.flows).toBe(false);
  expect(pluginNavState.enabledByPluginId.whatsapp).toBe(true);
});
```
(Wire the fetch mock + state reset EXACTLY like the existing tests in this file — read them and mirror the setup; the prose above describes intent, replace it with the file's real mocking idiom.)

- [ ] **Step 6: Run it, verify FAIL**

Run: `cd /home/nikolas/Documents/CODE/MINION/minion_hub && npx vitest run src/lib/state/plugin-nav.test.ts`
Expected: FAIL — `enabledByPluginId` undefined / not populated.

- [ ] **Step 7: Extend `plugin-nav.svelte.ts`**

Add `enabledByPluginId` to the state object and populate it in `hydratePluginNav()`:
```ts
// in the $state<{...}>({...}) shape:
enabledByPluginId: Record<string, boolean>;
// initial value: enabledByPluginId: {},

// inside hydratePluginNav(), after entries are fetched:
const enabled: Record<string, boolean> = {};
for (const e of entries) enabled[e.pluginId] = e.configEnabled !== false;
pluginNavState.enabledByPluginId = enabled;
```
(Place the initial `enabledByPluginId: {}` in BOTH the type and the initial object literal.)

- [ ] **Step 8: Run both hub test files, verify PASS**

Run: `cd /home/nikolas/Documents/CODE/MINION/minion_hub && npx vitest run src/lib/state/plugin-nav.test.ts src/lib/components/layout/sections.test.ts`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
cd /home/nikolas/Documents/CODE/MINION/minion_hub
git add src/lib/state/plugin-nav.svelte.ts src/lib/components/layout/sections.ts src/lib/state/plugin-nav.test.ts src/lib/components/layout/sections.test.ts
git commit -m "feat(flow): plugin-nav enabled map + flows nav-gate helpers (C)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Hub — apply the nav gate in the render sites

**Files:**
- Modify: `src/lib/components/layout/Topbar.svelte`
- Modify: `src/lib/components/layout/SectionSwitcher.svelte`
- Modify: `src/lib/components/layout/CommandPalette.svelte`

- [ ] **Step 1: Gate Topbar**

In `src/lib/components/layout/Topbar.svelte`: it imports `getSections` and computes `const sections = getSections();` (line ~17). Import `gateSections` and `pluginNavState`, and make `sections` reactive to the enabled map:
```ts
import { getSections, gateSections, findActiveSection } from "./sections";
import { pluginNavState } from "$lib/state/plugin-nav.svelte";
// replace the static `const sections = getSections();` with:
const sections = $derived(gateSections(getSections(), pluginNavState.enabledByPluginId));
```
Leave the existing `.filter((i) => !i.requires || canClient(i.requires))` on items as-is — `gateSections` runs first and only removes the flow-editor item. (If `sections` is used by `findActiveSection` in the same component, that now uses the gated list — correct, since a hidden item shouldn't be "active".)

- [ ] **Step 2: Gate SectionSwitcher**

In `src/lib/components/layout/SectionSwitcher.svelte`: it has `const staticSections = getSections();` (line ~7). Apply the same gate:
```ts
import { getSections, getDynamicPluginsSection, findActiveSection, gateSections } from "./sections";
import { pluginNavState } from "$lib/state/plugin-nav.svelte";
const staticSections = $derived(gateSections(getSections(), pluginNavState.enabledByPluginId));
```
Verify `staticSections` is used reactively downstream (it's `$derived`, so dependent `$derived`/markup updates automatically). If it was previously a plain `const` consumed by another plain `const`, convert that consumer to `$derived` too so the gate propagates.

- [ ] **Step 3: Gate CommandPalette**

Read `src/lib/components/layout/CommandPalette.svelte` and find how it sources flow-editor (it references `flow-editor`). If it builds its command list from `getSections()`, wrap that with `gateSections(getSections(), pluginNavState.enabledByPluginId)` (import both). If it has a hardcoded `/flow-editor` command entry, filter it out when `!isFlowsNavVisible(pluginNavState.enabledByPluginId)` (import `isFlowsNavVisible`). Match the component's existing reactivity (`$derived`).

- [ ] **Step 4: Type-check + autofixer**

Run: `cd /home/nikolas/Documents/CODE/MINION/minion_hub && bun run check 2>&1 | grep -E " ERROR " | grep -iE "Topbar|SectionSwitcher|CommandPalette" || echo "no new errors in touched files"`
Expected: "no new errors in touched files".
Then run the Svelte MCP autofixer (`mcp__plugin_svelte_svelte__svelte-autofixer`) on all THREE touched `.svelte` files; fix anything reported; re-run until clean.

- [ ] **Step 5: Commit**

```bash
cd /home/nikolas/Documents/CODE/MINION/minion_hub
git add src/lib/components/layout/Topbar.svelte src/lib/components/layout/SectionSwitcher.svelte src/lib/components/layout/CommandPalette.svelte
git commit -m "feat(flow): hide /flow-editor nav when flows plugin disabled (C)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Hub — route guard for `/flow-editor`

**Files:**
- Create: `src/lib/server/flows-gate.ts`
- Create: `src/lib/server/flows-gate.test.ts`
- Create: `src/routes/(app)/flow-editor/+layout.server.ts`

- [ ] **Step 1: Write the failing predicate test**

Create `src/lib/server/flows-gate.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { shouldBlockFlowEditor } from './flows-gate';

type E = { pluginId: string; configEnabled?: boolean };

describe('shouldBlockFlowEditor', () => {
  it('blocks when flows entry is explicitly disabled', () => {
    expect(shouldBlockFlowEditor([{ pluginId: 'flows', configEnabled: false }] as E[])).toBe(true);
  });
  it('allows when flows enabled', () => {
    expect(shouldBlockFlowEditor([{ pluginId: 'flows', configEnabled: true }] as E[])).toBe(false);
  });
  it('allows when flows entry has no configEnabled flag', () => {
    expect(shouldBlockFlowEditor([{ pluginId: 'flows' }] as E[])).toBe(false);
  });
  it('allows (fail-open) when there is no flows entry', () => {
    expect(shouldBlockFlowEditor([{ pluginId: 'whatsapp', configEnabled: false }] as E[])).toBe(false);
  });
  it('allows when entries is empty', () => {
    expect(shouldBlockFlowEditor([])).toBe(false);
  });
});
```

- [ ] **Step 2: Run it, verify FAIL**

Run: `cd /home/nikolas/Documents/CODE/MINION/minion_hub && npx vitest run src/lib/server/flows-gate.test.ts`
Expected: FAIL — module/function missing.

- [ ] **Step 3: Implement the predicate**

Create `src/lib/server/flows-gate.ts`:
```ts
import type { PluginUiManifestOccupant } from '$lib/plugins/PluginSlotHost.svelte';

/**
 * Block the flow editor only when a flows plugin entry exists AND is explicitly
 * disabled. Absent entry or absent flag ⇒ allow (fail-open / back-compat).
 */
export function shouldBlockFlowEditor(
  entries: Pick<PluginUiManifestOccupant, 'pluginId' | 'configEnabled'>[],
): boolean {
  const flows = entries.find((e) => e.pluginId === 'flows');
  return !!flows && flows.configEnabled === false;
}
```

- [ ] **Step 4: Run the predicate test, verify PASS**

Run: `cd /home/nikolas/Documents/CODE/MINION/minion_hub && npx vitest run src/lib/server/flows-gate.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Create the layout guard**

Create `src/routes/(app)/flow-editor/+layout.server.ts`:
```ts
import { redirect } from '@sveltejs/kit';
import { pluginsUiList } from '$lib/server/gateway-rpc';
import { shouldBlockFlowEditor } from '$lib/server/flows-gate';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals }) => {
  try {
    const entries = await pluginsUiList(locals.user?.supabaseId);
    if (shouldBlockFlowEditor(entries)) {
      throw redirect(307, '/workforce');
    }
  } catch (err) {
    // redirect() throws a Response with status+location — rethrow it. Any OTHER
    // error (gateway unreachable / no flows entry) ⇒ fail open: allow access.
    if (err && typeof err === 'object' && 'status' in err && 'location' in err) throw err;
  }
  return {};
};
```
(Verify the `pluginsUiList` signature in `src/lib/server/gateway-rpc.ts` — it is called elsewhere as `pluginsUiList(locals.user?.supabaseId)` and `pluginsUiList()`; pass the user id like the `/api/plugins/ui-list` endpoint does. Verify `locals.user?.supabaseId` is the correct accessor by checking that endpoint.)

- [ ] **Step 6: Type-check**

Run: `cd /home/nikolas/Documents/CODE/MINION/minion_hub && bun run check 2>&1 | grep -E " ERROR " | grep -iE "flow-editor|flows-gate" || echo "no new errors in touched files"`
Expected: "no new errors in touched files".

- [ ] **Step 7: Commit**

```bash
cd /home/nikolas/Documents/CODE/MINION/minion_hub
git add src/lib/server/flows-gate.ts src/lib/server/flows-gate.test.ts "src/routes/(app)/flow-editor/+layout.server.ts"
git commit -m "feat(flow): guard /flow-editor route when flows plugin disabled (C)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Final verification

**Files:** none (verification only)

- [ ] **Step 1: Gateway suite + tsc**

Run: `cd /home/nikolas/Documents/CODE/MINION/minion && npx vitest run src/flows/ extensions/flows/ && npx tsc --noEmit`
Expected: all flows + flows-plugin tests pass; tsc clean (or no NEW errors).

- [ ] **Step 2: Hub suite + check**

Run: `cd /home/nikolas/Documents/CODE/MINION/minion_hub && npx vitest run src/lib/components/layout/sections.test.ts src/lib/state/plugin-nav.test.ts src/lib/server/flows-gate.test.ts && bun run check 2>&1 | grep -E "ERRORS|WARNINGS" | tail -1`
Expected: tests pass; `bun run check` error count is the known baseline (18) — confirm none are in C files via `bun run check 2>&1 | grep -E " ERROR " | grep -iE "flows|flow-editor|sections|plugin-nav|Topbar|SectionSwitcher|CommandPalette" || echo "no C-file errors"`.

- [ ] **Step 3: Manual E2E checklist (report, do not automate)**

Document for the user to verify:
1. In **settings/plugins**, a **Flows** entry appears with a Power toggle + the static iframe page.
2. Toggling Flows **OFF** ⇒ the Gateway-menu **Flows** item disappears, and visiting `/flow-editor` redirects to `/workforce`.
3. Toggling **ON** ⇒ the item returns and the editor loads.
4. Flows never appears under the **Plugins** nav category in either state.
5. With a trigger-based flow registered, disabling Flows stops it from firing.

- [ ] **Step 4: Report** final commit SHAs across both repos + test counts + the manual checklist.

---

## Self-Review Notes (author)

- **Spec coverage:** new gateway plugin (T1), trigger gate (T2), nav enabled-map + gate helpers (T3), gate applied in all render sites incl. CommandPalette (T4), route guard with fail-open (T5), verification + manual E2E + "not in Plugins category" check (T6). settings/plugins requires no code (auto — noted in T6 step 3.1). All spec sections mapped.
- **Type consistency:** `isFlowsPluginEnabled` (gateway), `isFlowsNavVisible`/`gateSections` (sections.ts), `enabledByPluginId` (plugin-nav), `shouldBlockFlowEditor` (flows-gate) — names used identically across the tasks that reference them. `configEnabled` is the field on both the gateway `PluginsUiListEntry` and the hub `PluginUiManifestOccupant` (confirmed present).
- **Fail-open** is consistent in both the nav (`!== false`) and the guard (`=== false` to block; errors/absence allow).
- **No live gateway in unit tests:** every test uses stub configs / mocked fetch / plain predicates; the only gateway-touching code (`+layout.server.ts`) is kept thin and its logic lives in the unit-tested `shouldBlockFlowEditor`.
