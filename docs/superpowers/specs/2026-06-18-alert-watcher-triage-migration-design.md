# Alert-Watcher → Triage Autonomous Agent (Migration, Path C)

**Date:** 2026-06-18 (reconciled 2026-06-19 for phase 1.5)
**Status:** Approved design — ready for implementation plan
**Scope:** Subsystem #2 of the agent-artifacts roadmap. Re-frame the
`alert-watcher` gateway plugin as a canonical **Triage** autonomous agent on the
hub, remove its *hub plugin surfaces*, and give it a triage-specific artifact
fed by **hub-proxied gateway data**. Path C: ship the Triage agent + a triage
KPI/activity artifact now; the full ECharts dashboard (timeline/donut/journey)
is a fast-follow. Builds on the merged artifact foundation
(`2026-06-18-agent-artifacts-foundation-design.md`).

## Context & decisions

`alert-watcher` is a **gateway-resident** message-intercept triage kernel
(classifies every inbound message, fans out alerts, claimable handoff,
SQLite-persisted, `plugins.alerts.*` RPCs). Its interception MUST stay in the
gateway — the hub is not in the live message path. So this migration is **A1**:
re-frame + de-plugin on the hub side, keep the gateway kernel as the runtime.
A2 (stripping the gateway plugin manifest / converting the kernel to an internal
service) is explicitly deferred.

The triage **dashboard's data lives in the gateway** (`alerts.db`, exposed via
`plugins.alerts.summary` / `plugins.alerts.recent`). The artifact foundation is
hub-served and gated to `hub.artifact.context.get`. The bridge between them is
the **key new capability** this subsystem adds: the hub's artifact-context
resolver calls the gateway server-side (`gatewayCall`) and hands the result to a
hub-served artifact — the artifact never talks to the gateway directly, so the
foundation's security model is unchanged.

### Phase-1.5 reconciliation (shipped since this spec was written)

Phase 1.5 (card artifact gallery + per-agent flow) is now merged. Three deltas:

1. **`ArtifactDescriptor` now requires `icon` + `description`.** The triage
   descriptor supplies them: `icon: 'Megaphone'` (in `PLUGIN_ICON_MAP`),
   `description` = the localized triage-artifact summary. So
   `triageDescriptorFor(agentId, title, description)`.
2. **Every autonomous agent now has a representative flow.** Add a Triage flow
   to `AGENT_FLOWS` in `src/lib/flows/master-flows.ts` (id `agent-alert-watcher`)
   depicting the real kernel pipeline (inbound message → classify → severity
   router → alert fan-out + claimable handoff; non-complaint → no edge / normal
   agent loop), and set `flowId: 'agent-alert-watcher'` on the Triage descriptor.
   The card/detail "View flow" action (phase 1.5) then opens it read-only.
3. **The triage artifact surfaces via the card gallery.** The Alert Watcher
   card's `ArtifactGallery` renders the triage artifact as a `Megaphone` icon
   tile (popover = title/description) that opens it in the shared `Modal`
   (`ArtifactHost`) — plus the detail page. The render mechanism is unchanged
   (ArtifactHost → gated `hub.artifact.context.get` → the resolver below); the
   roster load already feeds `artifactsByAgent` per system agent, so the triage
   artifact appears automatically once `getArtifactsForAgent('alert-watcher')`
   returns it.

## Architecture

### 1. The Triage system agent

A new descriptor in the hub system-agent registry
(`src/lib/server/system-agents/registry.ts`), alongside Reminders:

- `id: 'alert-watcher'`, `name: 'Alert Watcher'`, `role: 'Message triage'`,
  `description`: "Classifies every inbound message and routes complaints to your
  team.", `trigger: 'Every inbound message'`, `avatarSeed: 'minion-alert-watcher'`,
  `managePath: null` (settings move out of the hub with de-plugin; a hub-native
  config surface is a later iteration — the agent detail page is the home).
- `moduleId: 'triage'` — a hub-module key with **no** `app_modules` row, so
  `isModuleEnabled` returns its default (absent = enabled) → the agent is listed
  by default and can be turned off later via Settings → Modules. (No registry
  type change; reuses the existing module-gating.)
- `resolveStatus(ctx)`: calls `gatewayCall('plugins.alerts.summary', { orgId: ctx.tenantId, sinceDays: 30 })` server-side (`.catch` → degraded). Maps:
  - unreachable / error → `{ enabled: true, state: 'attention', detail: 'Gateway unreachable' }`
  - reachable, `counts.total > 0` → `{ enabled: true, state: 'active', detail: '{total} alerts · {high} high (30d)' }`
  - reachable, no alerts → `{ enabled: true, state: 'active', detail: 'No alerts in 30d' }`
  - `stats` (the reminders-shaped `{sent,failed,skipped}`) is **omitted** — triage
    numbers live in `detail` (for the card) and the artifact (full).

### 2. The triage artifact (hub-served, gateway-fed)

A new built-in artifact bundle `triage`, attached only to the Triage agent:

- `getArtifactsForAgent(agentId)` returns the **triage** descriptor for
  `'alert-watcher'`, and the generic **overview** for every other agent
  (a small per-agent branch; default stays overview).
- **Context extension:** add an optional `data?: TriageArtifactData` field to
  `ArtifactContext` (an extensible per-artifact payload; the overview artifact
  ignores it). `TriageArtifactData = { counts: { total: number; high: number; med: number; low: number; notified: number; responded: number }; recent: Array<{ severity: 'low'|'med'|'high'; category: string; summary: string; createdAt: number }> }`.
- **Resolver:** `getArtifactContext(ctx, agentId, 'triage')` calls, server-side
  and org-scoped:
  - `gatewayCall('plugins.alerts.summary', { orgId: ctx.tenantId, sinceDays: 30 })` → `counts`
  - `gatewayCall('plugins.alerts.recent', { orgId: ctx.tenantId, limit: 10 })` → recent rows mapped to `{severity, category, summary, createdAt}`
  Both `.catch`-guarded so a gateway hiccup degrades to empty data, never 500s.
  The base `ArtifactContext` fields (name/role/etc.) come from the Triage agent
  VM as usual.
- **Bundle** `src/lib/artifacts/builtin/triage/index.html`: same self-contained,
  token-bound, bridge-protocol pattern as the Overview reference artifact, but
  renders triage KPIs as **stat cards** (Total / High / Notified / Responded) +
  a **recent-alerts list** (severity chip + category + summary + relative time).
  Token-styled (no hardcoded hex; severity colors via
  `var(--color-…, fallback)`), with the mandated loading/empty/error states and
  the four-framing structure (What I do / How I'm doing → counts / What I've done
  → recent / How I work → trigger). **No ECharts** (that's the fast-follow).

### 3. Hub-side de-plugin

Remove alert-watcher's presence *as a plugin* in the hub, without touching the
gateway (the kernel + `plugins.alerts.*` RPCs keep running):

- **Filter it out of the plugin UI listing.** `pluginsUiList()`
  (`src/lib/server/gateway-rpc.ts`) drops any occupant with
  `pluginId === 'alert-watcher'` (and the legacy `'alerts'`), so it no longer
  appears in Settings → Plugins, the control-center nav, or the plugins roster.
  A single `HIDDEN_PLUGIN_IDS` set documents why (migrated to the Triage agent).
- **Remove the nav category override.** Delete the `'alert-watcher'` /`'alerts'`
  entries from `PLUGIN_CATEGORY_OVERRIDES` in
  `src/lib/components/layout/sections.ts` (they only mattered while it showed in
  Customer Support).
- The gateway plugin's `minion.plugin.json`, hooks, `alerts.*` server-methods,
  and `alerts.db` are **untouched** (A2 territory). "Removed as a plugin" is true
  from the hub user's perspective: it's an autonomous agent now, not a plugin.

### 4. Data flow

```
/agents/autonomous            → Triage card (status via gatewayCall alerts.summary, org-scoped)
/agents/autonomous/alert-watcher (detail) → ArtifactHost(triage)
   iframe → bridge.call('hub.artifact.context.get')   [gated, no params]
     → ArtifactHost forwardRpc → GET /api/artifacts/triage/context?agentId=alert-watcher
       → requireCoreCtx → getArtifactContext(ctx,'alert-watcher','triage')
         → gatewayCall('plugins.alerts.summary'|'recent', {orgId: ctx.tenantId})  [server-side, system creds]
       → { ...agentFields, data: { counts, recent } }
   → triage artifact renders KPIs + recent list, themed
```

Every gateway call is `.catch`-guarded; the page/route degrade gracefully.

> The exact `plugins.alerts.summary` / `plugins.alerts.recent` param names
> (`orgId`, `sinceDays`/window, `limit`) are confirmed against the gateway
> handlers (`SummaryInput` / `PluginsAlertsRecentParams` in
> `minion/src/gateway/server-methods/alerts.ts`) during planning before the
> resolver is written — the shapes above are the design intent, not verified
> wire names.

## Components & files

| File | Change |
|---|---|
| `src/lib/agents/artifacts.ts` | EDIT — add `data?` to `ArtifactContext`; add `TriageArtifactData` type; `triageDescriptorFor(agentId, title, description)` (supplies `icon:'Megaphone'`) |
| `src/lib/flows/master-flows.ts` | EDIT — add `agent-alert-watcher` Triage flow to `AGENT_FLOWS` (classify→route→alert/handoff) |
| `src/lib/agents/artifacts.test.ts` | EDIT — tests for the triage descriptor + `data` passthrough |
| `src/lib/server/system-agents/registry.ts` | EDIT — add the Triage descriptor + gateway-summary `resolveStatus` |
| `src/lib/server/artifacts/registry.ts` | EDIT — `getArtifactsForAgent` returns triage for `alert-watcher`; `getArtifactContext` resolves triage via `gatewayCall` |
| `src/lib/artifacts/builtin/triage/index.html` | NEW — triage KPI + recent-alerts artifact bundle |
| `src/routes/artifacts/[artifactId]/ui/[...path]/+server.ts` | EDIT — register the `triage` bundle (`?raw` import) in `BUNDLES` |
| `src/lib/server/gateway-rpc.ts` | EDIT — `pluginsUiList()` filters `HIDDEN_PLUGIN_IDS` (`alert-watcher`, `alerts`) |
| `src/lib/components/layout/sections.ts` | EDIT — drop alert-watcher/alerts from `PLUGIN_CATEGORY_OVERRIDES` |
| `messages/en.json`, `messages/es.json` | EDIT — Triage agent name/role/desc/trigger + artifact strings |

## Out of scope (later)

- The full ECharts dashboard (stacked timeline, category donut, per-alert
  journey graph, filters) — the fast-follow artifact iteration (path B visuals),
  reusing the same hub-proxied resolver (add byDay/byCategory/topSenders to the
  context).
- A2: stripping the gateway plugin manifest / converting the kernel to an
  internal gateway service; deleting `extensions/alert-watcher/` or the
  `alerts.*` server-methods; live `gateway.json` changes.
- A hub-native triage *settings* surface (rubric/destinations/cooldown editing)
  — currently the gateway plugin's settings UI; de-plugined here, re-homed later.
- Reply-flow / suggestions changes (gateway-side, unaffected).

## Testing

- `artifacts.ts` pure additions: unit-test `triageDescriptorFor` + that
  `ArtifactContext.data` round-trips. (vitest)
- Registry resolvers (gateway-calling) are DB/RPC glue — verified by
  `bun run check` + live; the gateway-call mapping logic that is pure (counts →
  status `detail` string, rows → `recent`) is extracted to a tested pure helper
  in `artifacts.ts`.
- i18n parity en/es.

## Success criteria

- Settings → Plugins and the sidebar no longer list **Alert Watcher**; the
  Customer Support nav group no longer shows it.
- `/agents/autonomous` shows an **Alert Watcher** (Triage) card with a live
  status detail (e.g. "12 alerts · 3 high (30d)") sourced from the gateway.
- `/agents/autonomous/alert-watcher` renders the triage artifact: Total / High /
  Notified / Responded stat cards + a recent-alerts list, themed, via the
  hub-proxied gateway data (no gateway access from the iframe; served under
  `frame-ancestors 'self'`).
- The gateway alert-watcher kernel + `alerts.*` RPCs are unchanged and still
  functioning.
- `bun run check` clean; new vitest specs pass.
