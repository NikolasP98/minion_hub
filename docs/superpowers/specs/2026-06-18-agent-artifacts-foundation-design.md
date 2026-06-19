# Agent Artifacts — Design Spec + Foundation (Phase 1)

**Date:** 2026-06-18
**Status:** Approved design — ready for implementation plan
**Scope:** Phase 1 of the agent-artifacts vision. Establishes the artifact
**design spec** and the **rendering foundation** (built-in registry, serving
route, host component, per-agent detail surface) with one reference artifact.
Builds on the merged autonomous-agents page + system-agent registry
(`2026-06-18-autonomous-agents-page-design.md`).

## Vision (context)

Brain + Autonomous agents each own **artifact slot(s)** — visual surfaces that
answer, for that agent: *what do I do? what have I done? how am I doing? how do
I work?* Artifacts are static (HTML/Svelte) or live (WS/WebRTC), conform to a
**strict shared design spec**, and are ultimately generated on request by an
**artifact-builder agent** using the gateway SDK via a local gw MCP.

This phase builds only the **foundation + the design spec**, proven with one
hand-authored reference artifact. The builder agent, live (WS/WebRTC)
artifacts, the gw MCP, and DB-backed dynamic artifacts are explicitly later
phases.

## Substrate (reused, not rebuilt)

The hub already embeds sandboxed plugin UIs via a proven iframe + bridge stack.
Phase 1 reuses it wholesale:

- `src/lib/plugins/PluginIframe.svelte` — the iframe host (theme token snapshot
  → `host:hello`, resize, RPC forwarding).
- `src/lib/plugins/bridge-protocol.ts` (`HostBridge`) + `bridge-host.ts`
  (`mountHostBridge`) + the `@nikolasp98/plugin-ui-bridge` SDK — the postMessage
  RPC bridge. `PluginBridge.call(method, params)` is transport-agnostic.
- The `forwardRpc(method, params)` interception point inside `PluginIframe`
  already answers some methods hub-locally (e.g. `plugins.users.list`) instead
  of forwarding to the gateway WS.

**The three gaps a hub-owned artifact needs** (vs a gateway plugin UI):
1. **Serving** — the gateway serves plugin bundles at `/plugins/<id>/ui/*`. An
   artifact has no gateway; the **hub** serves its bundle.
2. **Discovery** — plugin UIs come from the `plugins.ui.list` gateway RPC; an
   artifact comes from a **hub-side registry**.
3. **Data** — an artifact fetches its data via a **hub-local `forwardRpc`
   handler**, never the gateway WS.

## Architecture

### 1. Design spec (the contract)

A written contract every artifact obeys, plus a shared token/chrome convention:

- **Theme/tokens:** the artifact applies the `tokens` map delivered in
  `host:hello` (the host already snapshots all `--*` CSS custom properties and
  the `light|dark` theme). Artifacts must not hardcode colors; they bind to the
  delivered tokens (which originate from `@minion-stack/design-tokens`).
- **Shell:** the hub renders consistent **outer chrome** (the `ArtifactHost`):
  a header (artifact title + owning agent's name/avatar) and mandated
  **loading / empty / error** states around the iframe. The artifact's **inner
  content** follows a documented layout grid and answers the four UX framings
  (*what I do / what I've done / how I'm doing / how I work*) as sections.
- **Sizing:** artifacts are responsive to the host container; height is driven
  by the existing `plugin:resize` message (fill-container mode for the detail
  surface).
- **Kind:** phase 1 supports `kind: 'static'` only. `live` (WS/WebRTC) is a
  later phase; the descriptor reserves the field.
- **Data binding:** artifacts read their data exclusively through
  `bridge.call('hub.artifact.context.get', { artifactId })` (and future
  artifact-scoped methods) — never direct DB or gateway access.

The spec is authored as `docs/artifacts/DESIGN-SPEC.md` and the reference
artifact (below) is its canonical example implementation.

### 2. Artifact registry (built-in, code — mirrors the system-agent registry)

No DB table in this phase. A code registry, server-only where it needs agent
data:

```ts
// src/lib/agents/artifacts.ts  (pure, client+server importable)
export interface ArtifactDescriptor {
  id: string;            // bundle id, unique among artifact bundles (e.g. "overview")
  agentId: string;       // owning agent id (e.g. "scheduling.reminders")
  slot: 'detail';        // where it renders (phase 1: the agent detail surface)
  title: string;         // shown in the shell header
  kind: 'static';        // 'live' reserved for later
  entrypoint: string;    // bundle path, e.g. "index.html"
}

export interface ArtifactContext {
  // The data the host hands an artifact on request (hub.artifact.context.get).
  agentId: string;
  agentName: string;
  agentRole: string;
  agentDescription: string;
  status: { state: 'active' | 'disabled' | 'attention'; enabled: boolean;
            stats?: { sent: number; failed: number; skipped: number }; detail?: string };
  trigger: string | null;
}
```

The **bundle** (`id`) is generic and may be shared across agents; the rendered
**instance** is the pair `(agentId, id)`. The reference "overview" bundle is
one set of files, attached to every system agent; the per-agent data comes from
the context call, which therefore carries **both** ids.

```ts
// src/lib/server/artifacts/registry.ts  (server-only — composes agent data)
export function getArtifactsForAgent(agentId: string): ArtifactDescriptor[];
export async function getArtifactContext(
  ctx: CoreCtx, agentId: string, artifactId: string,
): Promise<ArtifactContext | null>;
```

Phase 1 registers exactly one built-in artifact bundle: the **Agent Overview**
(`id: 'overview'`), attached to every system agent (so the Reminders agent
gets it immediately). `getArtifactContext` resolves the owning agent via the
existing system-agent registry (`getSystemAgentDescriptors` + `resolveStatus`),
returning `null` for an unknown agent/artifact pairing.

### 3. Serving the bundle

A SvelteKit server route serves built-in artifact bundles from a repo dir:

- Bundles live at `src/lib/artifacts/builtin/<artifactId>/` (e.g.
  `overview/index.html` + assets).
- Route `src/routes/artifacts/[artifactId]/ui/[...path]/+server.ts` reads and
  serves files from that dir (content-type by extension; 404 on traversal /
  missing). Path-traversal guard: resolve + assert the resolved path stays
  under the bundle dir.
- The hub sets `Content-Security-Policy: frame-ancestors 'self'` on this route
  so only the hub may embed it. (The hub controls its own headers — no gateway
  config needed.)

### 4. `ArtifactHost` component

`src/lib/components/artifacts/ArtifactHost.svelte` — a thin wrapper over
`PluginIframe` providing the design-spec shell:

- Props: `{ descriptor: ArtifactDescriptor }` (carries both `id` and `agentId`).
- Computes the iframe src: `/artifacts/${descriptor.id}/ui/${entrypoint}#hostOrigin=...`
  (reusing `PluginIframe`'s `uiBaseUrl` seam pointed at the hub's own origin).
- Renders shell chrome (title + states). Delegates the iframe + bridge to
  `PluginIframe` in `fillContainer` mode.
- Supplies a hub-local RPC handler for `hub.artifact.context.get` (see §6).

**Small required extension to `PluginIframe.svelte`:** today `forwardRpc` has a
single hardcoded local branch (`plugins.users.list`). Add an optional prop
`localHandlers?: Record<string, (params: unknown) => Promise<unknown>>` that
`forwardRpc` checks **before** forwarding to the gateway WS. `ArtifactHost`
passes `{ 'hub.artifact.context.get': fetchContext }`. This is additive and
leaves the existing plugin-UI behavior unchanged (no `localHandlers` → current
behavior).

### 5. Render surface — agent detail route

New route `src/routes/(app)/agents/autonomous/[id]/+page.server.ts` +
`+page.svelte`:

- `+page.server.ts`: `requireCoreCtx`; resolve the agent VM by `params.id`
  (the system-agent **VM id**, e.g. `scheduling.reminders`) from the
  system-agent registry (404 if unknown / module disabled — gateway-agent
  detail is out of scope this phase); return the agent VM + its
  `ArtifactDescriptor[]` (from `getArtifactsForAgent`).
- `+page.svelte`: header (avatar, name, job role, status pill, trigger) + the
  agent's artifact slot(s) rendered via `ArtifactHost`. No chat.
- The autonomous card's click / "Manage" (for a system agent) now routes here
  (`/agents/autonomous/[id]`) instead of straight to `managePath`; the detail
  page can still surface the external `managePath` (e.g. `/scheduling/reminders`)
  as a link.

### 6. Artifact data via `forwardRpc`

`ArtifactHost` registers a hub-local handler so the artifact's
`bridge.call('hub.artifact.context.get', { artifactId })` is answered from a
hub API route (not the gateway):

- New route `src/routes/api/artifacts/[id]/context/+server.ts` (GET): `[id]`
  is the artifact bundle id; `agentId` is a required query param. Auth via the
  user session (`requireCoreCtx`), returns `getArtifactContext(ctx, agentId, id)`
  (404 on null).
- `ArtifactHost`'s `localHandlers['hub.artifact.context.get']` receives
  `{ artifactId, agentId }` from the artifact's `bridge.call(...)`, fetches
  `/api/artifacts/${artifactId}/context?agentId=${agentId}`, and returns the
  JSON over the bridge. The artifact never needs a gateway WS or auth token
  (the fetch rides the user's hub session cookie).

## Security

- Iframe embedding gated by the hub's own CSP `frame-ancestors 'self'` on the
  `/artifacts/*` route (consistent with the existing plugin-UI model, which
  relies on `frame-ancestors`).
- Bridge origin gating is reused unchanged (host validates `pluginOrigin`;
  artifact validates `#hostOrigin`).
- The context route is session-authenticated and org-scoped via `requireCoreCtx`.
- Path-traversal guard on the serving route.

## Components & files

| File | Change |
|---|---|
| `docs/artifacts/DESIGN-SPEC.md` | NEW — the artifact design spec contract |
| `src/lib/agents/artifacts.ts` | NEW — pure descriptor + context types |
| `src/lib/agents/artifacts.test.ts` | NEW — type/shape + descriptor-id helper tests |
| `src/lib/server/artifacts/registry.ts` | NEW — built-in registry + `getArtifactContext` |
| `src/lib/artifacts/builtin/overview/index.html` (+ css) | NEW — reference artifact bundle |
| `src/routes/artifacts/[artifactId]/ui/[...path]/+server.ts` | NEW — bundle serving + CSP + traversal guard |
| `src/routes/api/artifacts/[id]/context/+server.ts` | NEW — artifact data (auth, org-scoped) |
| `src/lib/components/artifacts/ArtifactHost.svelte` | NEW — shell + PluginIframe wrapper + local `hub.artifact.context.get` handler |
| `src/lib/plugins/PluginIframe.svelte` | EDIT — add optional `localHandlers` prop checked in `forwardRpc` before gateway forwarding (additive) |
| `src/routes/(app)/agents/autonomous/[id]/+page.server.ts` | NEW — agent detail load |
| `src/routes/(app)/agents/autonomous/[id]/+page.svelte` | NEW — detail page + artifact slot |
| `src/lib/components/agents/AutonomousAgentCard.svelte` | EDIT — card click/Manage routes to `/agents/autonomous/[id]` |
| `messages/en.json`, `messages/es.json` | EDIT — detail/artifact i18n keys |

## Out of scope (later phases)

- The artifact-builder autonomous agent (generates artifacts on request).
- Live artifacts (WS/WebRTC).
- The local gw MCP surface.
- DB-backed dynamic / user-requested artifacts (the registry stays code-only).
- Brain-agent artifact rendering surface (data model is agent-agnostic; only
  the autonomous detail surface renders artifacts in this phase).
- The alert-watcher migration + porting its dashboard as an artifact (next phase,
  the foundation's first real consumer).

## Success criteria

- Navigating to `/agents/autonomous/scheduling.reminders` (the Reminders agent)
  shows the detail header + an embedded **Agent Overview** artifact that renders the
  agent's identity, role, live status, and activity, themed to match the hub
  (tokens delivered over the bridge), with loading/error states.
- The artifact loads its data via `hub.artifact.context.get` through the bridge
  (no gateway WS), served from the hub `/artifacts/overview/ui/...` route under
  `frame-ancestors 'self'`.
- The artifact visually conforms to `docs/artifacts/DESIGN-SPEC.md`.
- `bun run check` clean; new vitest specs pass.
