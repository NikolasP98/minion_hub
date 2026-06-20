# Builder-as-Agent Card (Subsystem 5c.4)

**Date:** 2026-06-20
**Status:** Approved (user: "keep 5.3 and proceed with .4") — ready for plan
**Scope:** Surface the artifact-builder as an **admin-only autonomous agent** in the
roster — the original #5 "admin-only system agent" framing — with a representative
flow and its own **"what I've built"** dashboard artifact. Visibility/management; no
new generation capability (builder already works via the gallery `+`). (5c.3 async
stays on the roadmap; deferred.)

## Context (verified)

- System agents: `getSystemAgentDescriptors()` (`registry.ts`) returns descriptors `{ id, moduleId, name, role, description, avatarSeed, trigger, managePath, flowId, resolveStatus, resolveVariables? }`; `loadSystemAgentVMs(ctx)` → `AutonomousAgentVM[]` (no admin filter today). Roster `(app)/agents/autonomous/+page.server.ts`: `systemAgents = await loadSystemAgentVMs(ctx)`, `isAdmin = locals.user?.role === 'admin'`. Detail `[id]/+page.server.ts` loads one agent.
- Built-in artifacts: `getArtifactsForAgent(ctx, agentId)` returns `overviewDescriptorFor`/`triageDescriptorFor`; bundles served from `BUNDLES` (`overview`,`triage`) in `src/routes/artifacts/[artifactId]/ui/[...path]/+server.ts`; `getArtifactContext` resolves per agent (base + `data`/`vars`). Bundles are token-bound, sandboxed, use the `hub.artifact.context.get` bridge.
- 5a store: `agent_artifacts` (org-scoped). DB artifacts = builder-generated (have `prompt`) or manually pasted.
- AGENT_FLOWS (`master-flows.ts`): `MasterFlow` per agent; `getMasterFlow`. `flowExportedSpecs`/exports (5b.1).

## Decisions

1. **`adminOnly` flag on the descriptor/VM** (not a separate registry). The builder descriptor sets `adminOnly: true`; the roster filters `!vm.adminOnly || isAdmin`, and the detail page 404s an admin-only agent for non-admins. Minimal, reuses the existing registry.
2. **Builder is a "meet + monitor" surface, no `+`.** Its card shows its dashboard artifact (what it's built); creating custom artifacts stays on the *target* agents' `+` (the builder generates them). `canAdd=false` for the builder card.
3. **Dashboard artifact = built-in bundle** (`artifact-builder/index.html`, like overview/triage), fed org-scoped data: total artifacts built + recent ones (title, agent, version, updated). No new generation; read-only stats.
4. **Representative flow** `agent-artifact-builder`: request → assemble the agent's variable schema → LLM generate → self-repair/validate → store. Read-only viewer (matches other agent flows).

## Architecture

### 1. Admin-only visibility
- `src/lib/agents/autonomous.ts`: add `adminOnly?: boolean` to `SystemAgentMeta` + `AutonomousAgentVM` (passed through `systemMetaToVM`).
- Roster load: `systemAgents.filter((a) => !a.adminOnly || isAdmin)` (isAdmin already computed). Detail `[id]/+page.server.ts`: after resolving the agent, if `agent.adminOnly && locals.user?.role !== 'admin'` → `error(404)`.

### 2. Builder descriptor — `registry.ts`
A new descriptor:
- `id: 'artifact-builder'`, `moduleId: 'artifacts'` (no `app_modules` row → default-on), `adminOnly: true`, `name`/`role`/`description`/`trigger` (i18n), `avatarSeed: 'minion-artifact-builder'`, `managePath: null`, `flowId: 'agent-artifact-builder'`.
- `resolveStatus(ctx)`: `countArtifacts(ctx)` → `{ enabled: true, state: 'active', detail: '{n} artifacts built' }` (`.catch` → attention).
- `resolveVariables(ctx, keys)`: `artifacts.builtCount` (count) + `artifacts.recent` (recent list) — for the dashboard's `vars`.

### 3. Builder flow — `master-flows.ts`
`agent-artifact-builder` `MasterFlow` (read-only): nodes request(trigger) → schema(process, "assemble agent variable schema") → generate(llm, "OpenRouter · whole-bundle from reference") → repair(guard, "validate + self-repair retry") → store(memory, "agent_artifacts"). Optional exports: `artifacts.builtCount`.

### 4. Dashboard artifact — bundle + registry + data
- `getArtifactsForAgent(ctx, 'artifact-builder')` → a `builder` descriptor (`artifactBuilderDescriptorFor(...)`, icon `Sparkles`/`Wand2`, kind static, entrypoint index.html). (No DB artifacts for this agent.)
- Bundle `src/lib/artifacts/builtin/artifact-builder/index.html` — token-bound, bridge-protocol (copy overview's `<script>` verbatim), renders: total built (stat) + a recent-artifacts list (title • agent • v{version} • relative time) from `context.vars`. Loading/empty/error states. Registered in `BUNDLES` (`?raw`).
- `getArtifactContext(ctx, 'artifact-builder', 'builder')` → base + `vars: { 'artifacts.builtCount': n, 'artifacts.recent': rows }` (via the descriptor's `resolveVariables` / direct store calls).
- Store (`store.ts`): `countArtifacts(ctx): Promise<number>` + `listRecentArtifacts(ctx, limit): Promise<Array<{title, agentId, version, updatedAt}>>` (org-scoped, withOrgCore).

## Components & files

| File | Change |
|---|---|
| `src/lib/agents/autonomous.ts` | EDIT — `adminOnly?` on `SystemAgentMeta` + `AutonomousAgentVM` (+ `systemMetaToVM` passthrough) |
| `src/lib/server/system-agents/registry.ts` | EDIT — builder descriptor (adminOnly, resolveStatus, resolveVariables) |
| `src/lib/flows/master-flows.ts` | EDIT — `agent-artifact-builder` flow in `AGENT_FLOWS` |
| `src/lib/server/artifacts/store.ts` | EDIT — `countArtifacts`, `listRecentArtifacts` |
| `src/lib/agents/artifacts.ts` | EDIT — `artifactBuilderDescriptorFor(agentId, title, description)` (id `builder`, icon) |
| `src/lib/server/artifacts/registry.ts` | EDIT — `getArtifactsForAgent` returns the builder descriptor for `artifact-builder`; `getArtifactContext` resolves `builder` artifact data |
| `src/lib/artifacts/builtin/artifact-builder/index.html` | NEW — builder dashboard bundle |
| `src/routes/artifacts/[artifactId]/ui/[...path]/+server.ts` | EDIT — register `builder` bundle in `BUNDLES` |
| `src/routes/(app)/agents/autonomous/+page.server.ts` | EDIT — filter `adminOnly` agents by `isAdmin` |
| `src/routes/(app)/agents/autonomous/[id]/+page.server.ts` | EDIT — 404 admin-only agent for non-admins |
| `messages/en.json`, `messages/es.json` | EDIT — builder name/role/desc/trigger + artifact strings |

## Out of scope (later)

- 5c.3 async/progress (kept, deferred). Editing the builder's settings; the builder generating on a schedule (it's request-driven). Per-org enable/disable of the builder agent.

## Testing

- `artifacts.ts`: unit-test `artifactBuilderDescriptorFor` (id `builder`, icon, static). `master-flows`: `agent-artifact-builder` resolves + (if exports) unique keys.
- Registry/store/bundle/filtering: `bun run check` + live (admin sees the Builder card; non-admin does not; its dashboard renders built-count + recent; detail 404 for non-admin).
- i18n parity en/es; Svelte autofixer if any `.svelte` (loads only here — likely none new).

## Success criteria

- An **admin** sees an **Artifact Builder** card in `/agents/autonomous` (dicebear avatar, role/desc, status "N artifacts built") whose flow opens read-only and whose dashboard artifact shows total built + recent generations. A **non-admin** does not see it (and 404s on the detail URL).
- No `+`/create on the builder card; built-ins + other agents unaffected.
- `bun run check` clean; pure unit tests pass. (No new migration — reuses `agent_artifacts`.)
