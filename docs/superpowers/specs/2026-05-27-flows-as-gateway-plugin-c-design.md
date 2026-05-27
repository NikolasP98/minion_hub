# Flows as a Gateway Plugin (Sub-feature C)

**Date:** 2026-05-27
**Status:** Approved — pending spec review
**Repos:** `minion` (gateway — new `flows` extension + trigger gate, branch `DEV`) · `minion_hub` (nav gating + route guard, branch `dev`). `langgraph-server` is **untouched**.
**Series:** Sub-feature **C** of the flow-editor rework (A = cascading Agent node, B = built-in graph nodes [B1/B2/B3], C = flows-as-plugin). A and B are DONE.

---

## Problem

The flow editor is currently a hardcoded, always-on hub route (`/flow-editor`, under the **Gateway** nav section) gated by nothing. The rework's final goal is to make flows a first-class, **toggleable plugin** configurable from **settings/plugins** — but with two constraints that make it unlike every other plugin:

1. It must render under the **Gateway** nav category, **not** the dynamic **Plugins** category.
2. When **disabled**, it must disappear from the nav and be unreachable (like other plugins), and its trigger-based execution must stop.

The hub's entire plugin system is **gateway-rooted**: `plugins.ui.list` (gateway RPC) drives the nav + settings page, and enable/disable persists in gateway `gateway.json` under `plugins.entries[id].config.enabled` (default `true`), toggled via the hub's existing `/api/plugins/{id}/toggle`. Flows is the odd case because its *editor* is a native hub route (not an iframe-sandboxed plugin UI), while its *execution* runs through the gateway trigger-manager + the external langgraph runner.

---

## Locked Decisions

- **Plugin model:** flows is a **real gateway plugin** (a new `extensions/flows/`) — reuses `plugins.ui.list`, the existing toggle endpoint, and `config.enabled` persistence; disabling also gates gateway trigger execution.
- **Settings panel:** **gateway-served iframe** (uniform with other plugins), authored as a minimal static page (no framework/build app).
- **Disabled route:** **hide nav item AND guard the route** (redirect to `/workforce` on direct access).
- **Default state:** **enabled by default** (flows is currently always-on; default-enabled avoids an upgrade surprise).

---

## Architecture

```
Gateway (minion, DEV)                              Hub (minion_hub, dev)
─────────────────────                              ─────────────────────
extensions/flows/                                  sections.ts  (Gateway section has /flow-editor)
  minion.plugin.json  ─┐                                  │  filtered out iff flows present & disabled
  index.ts (no-op)     │                                  ▼
  ui/dist/index.html   │   plugins.ui.list ──────▶ hydratePluginNav() → enabledByPluginId['flows']
                       │   (entry.configEnabled)         │
plugins.config.set ◀───┴── /api/plugins/flows/toggle ◀── settings/plugins Power toggle (existing)
  → gateway.json plugins.entries.flows.config.enabled
                       │
src/flows/trigger-manager.ts                       flow-editor/+layout.server.ts
  handleTriggerEvent: if !isFlowsPluginEnabled() skip      └─ pluginsUiList(): if flows disabled → redirect /workforce
```

- **Why flows stays OUT of the Plugins nav category:** the dynamic Plugins section is built only from `plugins.controlCenter`-slot entries (`getDynamicPluginsSection` consumes `pluginNavState.controlCenters`). The flows plugin declares **only** a `settings.plugins` slot, so it never enters that section. It appears in the Gateway section via the existing static item (now visibility-gated).
- **Why it appears in settings/plugins automatically:** the settings page loads `pluginsUiList()` filtered to `slot === 'settings.plugins'` and renders each as a `PluginIframe` with a Power toggle header. The flows plugin's `settings.plugins` entry satisfies this with no hub change.

---

## Gateway Changes (`minion`, branch `DEV`, pnpm)

### 1. New extension `extensions/flows/`

**`extensions/flows/minion.plugin.json`:**
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
- `id: "flows"` is the canonical plugin id used everywhere (toggle, nav gating, trigger gate).
- No `plugins.controlCenter` slot (keeps it out of the Plugins nav category). No `flowNodes` (node types remain hardcoded in langgraph-server + hub; this plugin is identity + enable-state + settings only).
- `configSchema.enabled` is documented but its DEFAULT is implicit `true` (the read-side default in `plugins.ts:56`/`:90`), matching every other plugin.

**`extensions/flows/index.ts`:** a no-op plugin (exists for discovery + identity; execution lives in `src/flows/`):
```ts
import type { MinionPluginApi } from "../../src/plugins/types.js";

const plugin = {
  id: "flows",
  register(_api: MinionPluginApi) {
    // No gateway methods/hooks/channels. Flow execution is handled by the
    // built-in src/flows/ trigger-manager; this plugin provides identity,
    // the settings.plugins UI, and the enable/disable master switch.
  },
};

export default plugin;
```
(Match the exact `MinionPluginDefinition`/default-export shape used by `extensions/flow-example/index.ts` — verify the type import path and the `register` signature against it at implementation time.)

**`extensions/flows/ui/dist/index.html`:** a hand-authored static settings page (NO Vite app, NO build step — the build pipeline only compiles `index.ts`; static `ui/dist/` files are served as-is by `plugin-ui-static.ts`). Minimal, framework-free, self-contained (inline CSS), informational only — the enable/disable toggle is the hub's plugin-header `Power` control. Content:
- A heading "Flows".
- A short paragraph: flows powers the visual flow editor and trigger-based automation; use the Power toggle above to enable/disable; the editor opens from the **Gateway** menu when enabled.
- Render gracefully against a dark or light host (use `prefers-color-scheme` or neutral colors); the page does NOT need to implement the theme bridge for MVP.

### 2. Trigger gate — `src/flows/trigger-manager.ts`

Add a helper that reads the flows plugin master switch from gateway config, and call it in `handleTriggerEvent` before dispatching each flow:

```ts
// Reads the flows plugin master switch; absent ⇒ enabled (default-on).
export function isFlowsPluginEnabled(config: GatewayConfig): boolean {
  const entry = config.plugins?.entries?.flows;
  const flag = entry?.config?.enabled;
  return typeof flag === "boolean" ? flag : true;
}
```
In `handleTriggerEvent` (currently iterating the registry and calling `void fireFlow(...)` at ~line 158): read the current gateway config (via whatever accessor the trigger-manager already has — verify; it must already reach config to know `FLOWS_RUNNER_URL`), and if `!isFlowsPluginEnabled(config)` **return early before the loop** (skip all trigger firing). Exact config-access pattern + the `GatewayConfig` type must be matched to the existing code at implementation time — if the trigger-manager has no config handle, source it the same way `fireFlow` resolves `FLOWS_RUNNER_URL`.

(Early-return-before-loop is preferred over per-flow checks: the flag is plugin-wide, so one check per event is sufficient and cheaper.)

---

## Hub Changes (`minion_hub`, branch `dev`, bun)

### 3. Nav gating

**`src/lib/state/plugin-nav.svelte.ts`:** extend `pluginNavState` with `enabledByPluginId: Record<string, boolean>` and populate it in `hydratePluginNav()` from each ui-list entry's `configEnabled` field. (The `/api/plugins/ui-list` payload entries carry `configEnabled` — verify the field is present on the hub-side `PluginUiManifestOccupant` type; if not, add it to the type and ensure the ui-list endpoint forwards it from the gateway `plugins.ui.list` result.)

```ts
// in pluginNavState
enabledByPluginId: Record<string, boolean>;
// in hydratePluginNav(), while iterating entries:
const enabled: Record<string, boolean> = {};
for (const e of entries) enabled[e.pluginId] = e.configEnabled !== false;
pluginNavState.enabledByPluginId = enabled;
```

**Nav consumer (the Gateway-section render — `Topbar.svelte` / `SectionSwitcher.svelte`, wherever `getSections()` items are rendered):** filter the `/flow-editor` item out of the Gateway section when flows is present-and-disabled. Implement as a small pure helper so it's unit-testable:

```ts
// flows visible unless an explicit disabled flag exists for pluginId "flows".
export function isFlowsNavVisible(enabledByPluginId: Record<string, boolean>): boolean {
  return enabledByPluginId.flows !== false;   // absent ⇒ visible (back-compat)
}
```
Apply it where Gateway items are mapped: drop the item whose `href === '/flow-editor'` when `!isFlowsNavVisible(...)`. Do the same filter for the **CommandPalette** flow-editor entry (it draws from the same sections data — verify and gate consistently).

### 4. Route guard — `src/routes/(app)/flow-editor/+layout.server.ts` (new)

A `+layout.server.ts` at the `flow-editor/` level guards index, `[id]`, and `skills/` together:
```ts
import { redirect } from '@sveltejs/kit';
import { pluginsUiList } from '$lib/server/gateway-rpc';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async () => {
  try {
    const entries = await pluginsUiList();
    const flows = entries.find((e) => e.pluginId === 'flows');
    if (flows && flows.configEnabled === false) {
      throw redirect(307, '/workforce');
    }
  } catch (err) {
    // A redirect() is a thrown Response — rethrow it. Any OTHER error
    // (gateway unreachable / no flows entry) ⇒ fail open: allow access.
    if (err && typeof err === 'object' && 'status' in err && 'location' in err) throw err;
  }
  return {};
};
```
- **Fail-open** on transient gateway errors or a missing flows entry (never lock users out of an existing feature because the gateway hiccuped).
- If `flow-editor` already has a `+layout.ts`/`+layout.svelte`, this server load composes with it; if there is an existing `+page.server.ts` for the index, keep it — layout load runs for all nested routes.

### 5. settings/plugins — no change

Flows appears automatically as a `settings.plugins` entry with the standard Power toggle + iframe. Confirm during manual E2E.

---

## Error Handling

| Scenario | Behavior |
|---|---|
| Gateway unreachable when hub builds nav | `enabledByPluginId.flows` undefined ⇒ `isFlowsNavVisible` returns true ⇒ item shown (fail-open). |
| Gateway unreachable in the route guard | Non-redirect error caught ⇒ access allowed (fail-open). |
| `flows` plugin not installed (older gateway) | No `flows` entry ⇒ nav shown, route allowed, trigger gate defaults enabled. No regression. |
| Flows disabled, user hits `/flow-editor` directly | `+layout.server.ts` redirects to `/workforce`. |
| Flows disabled, trigger event fires | `handleTriggerEvent` early-returns; no flow runs. |
| `config.enabled` absent in gateway config | Treated as `true` everywhere (gateway + hub), consistent with platform convention. |

---

## Testing

**Gateway (`minion`, `pnpm test` / vitest):**
- `isFlowsPluginEnabled`: `{enabled:true}`→true, `{enabled:false}`→false, absent entry→true, absent flag→true.
- `handleTriggerEvent`: with a stubbed config where flows is disabled, `fireFlow` is NOT called for a matching trigger; with flows enabled (or absent), it IS called. (Inject/spy `fireFlow` per the existing test seams.)
- Plugin discovery/manifest: the `flows` manifest is valid and loads (run the discovery/loader over `extensions/flows/`, or the existing manifest-validation test path); `pluginsUiList()` output includes a `flows` entry with `slot: 'settings.plugins'` and `configEnabled` defaulting true.

**Hub (`minion_hub`, `bun run check` + vitest where present):**
- `isFlowsNavVisible`: `{}`→true, `{flows:true}`→true, `{flows:false}`→false, `{other:false}`→true.
- `hydratePluginNav` populates `enabledByPluginId` from entry `configEnabled` (extend the existing `plugin-nav.test.ts`).
- Route-guard predicate: a small testable function `shouldBlockFlowEditor(entries)` (flows present & disabled ⇒ true; else false) unit-tested; the `+layout.server.ts` calls it. (Avoids needing a full SvelteKit load harness.)
- `bun run check` clean of NEW errors (18 pre-existing unrelated errors are the known baseline).

**Manual E2E:** In settings/plugins, toggle Flows OFF → the Gateway-menu "Flows" item disappears and `/flow-editor` redirects to `/workforce`; toggle ON → item returns and the editor loads. Confirm Flows does NOT appear under the Plugins nav category in either state. With a trigger-based flow registered, disabling Flows stops it from firing.

---

## Out of Scope (later)

- Moving the `/flow-editor` route itself into an iframe-sandboxed plugin UI (stays a native hub route).
- Per-user / per-org flows enablement (this is gateway-wide, like other plugins).
- Migrating flow node types into the plugin manifest's `flowNodes` (node types remain hardcoded in langgraph-server + hub).
- A theme-bridge-aware flows settings iframe (MVP iframe is static/informational).
- Deferred drone execution (tracked separately, unrelated to C).

---

## Config Summary

- No new env vars. Reuses `FLOWS_RUNNER_URL` (gateway → langgraph runner) and `PUBLIC_LANGGRAPH_FLOWS_URL` (hub editor).
- No new dependencies in either repo.
- New gateway plugin id: **`flows`** (canonical, used by the toggle endpoint, nav gating, route guard, and trigger gate).
