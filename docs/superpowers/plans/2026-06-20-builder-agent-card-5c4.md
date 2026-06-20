# Builder-as-Agent Card (5c.4) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`).

**Goal:** Surface the artifact-builder as an admin-only autonomous agent (card + representative flow + its own "what I've built" dashboard artifact).

**Architecture:** `adminOnly` flag on the system-agent descriptor/VM (roster filter + detail guard) + a builder descriptor + a representative flow + a built-in dashboard bundle fed org-scoped stats. No new migration.

**Tech Stack:** SvelteKit 2, Svelte 5 runes, TS, Drizzle (gxv), `withOrgCore`, Paraglide, Vitest, Bun. Hub, branch `dev`.

## Global Constraints

- Svelte 5 runes; TS strict, no `any`; i18n BOTH locales + `bun run i18n:compile` before check; check 0/0; tests green. Commits UNSIGNED; no lockfile/sdd in commits. Svelte autofixer on any `.svelte`.
- Tenancy: store via `withOrgCore`; admin gating server-side (detail 404 + the builder's data is org-scoped).

## Reference: verified shapes

- `src/lib/agents/autonomous.ts`: `SystemAgentMeta` + `AutonomousAgentVM` + `systemMetaToVM`. Reminders/triage/alert-watcher descriptors in `registry.ts` `getSystemAgentDescriptors()` (each `{id, moduleId, name, role, description, avatarSeed, trigger, managePath, flowId, resolveStatus(ctx), resolveVariables?(ctx,keys)}`). `loadSystemAgentVMs(ctx)` → VMs.
- Roster `(app)/agents/autonomous/+page.server.ts`: `systemAgents = await loadSystemAgentVMs(ctx)`, `isAdmin = locals.user?.role === 'admin'`, returns `{systemAgents, isAdmin, artifactsByAgent, flowTogglesByFlow}`. Detail `[id]/+page.server.ts`: resolves one VM from `loadSystemAgentVMs`.
- Artifacts: `ArtifactDescriptor {id,agentId,slot,title,description,icon,kind,entrypoint,deletable?}`; `overviewDescriptorFor`/`triageDescriptorFor` (`artifacts.ts`). `getArtifactsForAgent(ctx,agentId)` + `getArtifactContext(ctx,agentId,artifactId)` (`server/artifacts/registry.ts`, `withVars` helper). `ArtifactContext {..., vars?}`. Bundles in `BUNDLES` (serving route), `?raw` import; overview bundle is the bridge-client reference.
- Store (`server/artifacts/store.ts`): `withOrgCore(scope(ctx),fn)`, `agentArtifacts`, `eq,and,desc,sql` imported. `master-flows.ts`: `AGENT_FLOWS`, `MasterFlow`, `at(col,lane)`, kinds trigger/process/llm/guard/memory/channel/router/intercept/end; `flowExportedSpecs`.
- `resolvePluginIcon`/`PLUGIN_ICON_MAP` (`$lib/plugins/icon-map`) — icon must be in the map (else Puzzle fallback); `Sparkles`/`Wand2` — confirm one is in the map, else add it.

---

### Task 1: `adminOnly` flag + roster filter + detail guard

**Files:** Modify `src/lib/agents/autonomous.ts`, `src/routes/(app)/agents/autonomous/+page.server.ts`, `src/routes/(app)/agents/autonomous/[id]/+page.server.ts`.

**Interfaces — Produces:** `SystemAgentMeta.adminOnly?: boolean`, `AutonomousAgentVM.adminOnly?: boolean`.

- [ ] **Step 1: Flag** — in `autonomous.ts`: add `adminOnly?: boolean;` to `SystemAgentMeta` and `AutonomousAgentVM`; in `systemMetaToVM` pass `adminOnly: meta.adminOnly` through.

- [ ] **Step 2: Roster filter** — in `(app)/agents/autonomous/+page.server.ts`, after computing `isAdmin`, filter: `const visibleAgents = systemAgents.filter((a) => !a.adminOnly || isAdmin);` and use `visibleAgents` for `artifactsByAgent`/`flowTogglesByFlow`/the returned `systemAgents`.

- [ ] **Step 3: Detail guard** — in `[id]/+page.server.ts`, after resolving the agent VM: `if (agent.adminOnly && locals.user?.role !== 'admin') throw error(404, 'not found');` (import `error` from `@sveltejs/kit` if needed).

- [ ] **Step 4: Verify + commit** — `bun run check` 0.
```bash
git add src/lib/agents/autonomous.ts "src/routes/(app)/agents/autonomous/+page.server.ts" "src/routes/(app)/agents/autonomous/[id]/+page.server.ts"
git -c commit.gpgsign=false commit -m "feat(agents): adminOnly flag on system agents (roster filter + detail 404 guard)"
```

---

### Task 2: Store — built-count + recent

**Files:** Modify `src/lib/server/artifacts/store.ts`.

**Interfaces — Produces:** `countArtifacts(ctx): Promise<number>`; `listRecentArtifacts(ctx, limit?): Promise<Array<{ title: string; agentId: string; version: number; updatedAt: Date }>>`.

> No unit test (DB glue). Verified by `bun run check` + live.

- [ ] **Step 1: Implement** — in `store.ts` (uses existing `withOrgCore`, `agentArtifacts`, `eq`, `and`, `desc`; add `count` from `drizzle-orm` if used, else `sql`):
```ts
export function countArtifacts(ctx: CoreCtx): Promise<number> {
  return withOrgCore(scope(ctx), async (tx) => {
    const rows = await tx.select({ n: sql<number>`count(*)::int` }).from(agentArtifacts).where(eq(agentArtifacts.orgId, ctx.tenantId));
    return rows[0]?.n ?? 0;
  });
}

export function listRecentArtifacts(ctx: CoreCtx, limit = 8): Promise<Array<{ title: string; agentId: string; version: number; updatedAt: Date }>> {
  return withOrgCore(scope(ctx), (tx) =>
    tx.select({ title: agentArtifacts.title, agentId: agentArtifacts.agentId, version: agentArtifacts.version, updatedAt: agentArtifacts.updatedAt })
      .from(agentArtifacts).where(eq(agentArtifacts.orgId, ctx.tenantId))
      .orderBy(desc(agentArtifacts.updatedAt)).limit(limit));
}
```

- [ ] **Step 2: Verify + commit** — `bun run check` 0.
```bash
git add src/lib/server/artifacts/store.ts
git -c commit.gpgsign=false commit -m "feat(artifacts): countArtifacts + listRecentArtifacts (org-scoped) for the builder dashboard"
```

---

### Task 3: Builder descriptor + flow + agent i18n

**Files:** Modify `src/lib/server/system-agents/registry.ts`, `src/lib/flows/master-flows.ts`, `messages/en.json`, `messages/es.json`.

- [ ] **Step 1: i18n (agent)** — both locales: `sysagent_builder_name` ("Artifact Builder"/"Constructor de artefactos"), `sysagent_builder_role` ("Builds custom artifacts"/"Crea artefactos personalizados"), `sysagent_builder_desc` ("Generates custom dashboards on request from your agents' data."/"Genera paneles personalizados a partir de los datos de tus agentes."), `sysagent_builder_trigger` ("On admin request"/"A petición del administrador"), `sysagent_builder_status` ("{n} artifacts built"/"{n} artefactos creados").

- [ ] **Step 2: Builder flow** — in `master-flows.ts` `AGENT_FLOWS`, add `agent-artifact-builder` (read-only): nodes `request`(trigger, "Admin requests an artifact"), `schema`(process, "Assemble the agent's exported variable schema"), `generate`(llm, "OpenRouter · whole-bundle from the reference"), `repair`(guard, "Validate + self-repair retry", branches pass/fail), `store`(memory, "agent_artifacts (org-scoped)"), `done`(end). Edges request→schema→generate→repair, repair(pass)→store→done, repair(fail)→generate (retry). Use valid `MasterNodeKind`s.

- [ ] **Step 3: Builder descriptor** — in `registry.ts`, add to `getSystemAgentDescriptors()`:
```ts
    {
      id: 'artifact-builder', moduleId: 'artifacts', adminOnly: true,
      name: m.sysagent_builder_name(), role: m.sysagent_builder_role(),
      description: m.sysagent_builder_desc(), avatarSeed: 'minion-artifact-builder',
      trigger: m.sysagent_builder_trigger(), managePath: null, flowId: 'agent-artifact-builder',
      async resolveStatus(ctx) {
        const n = await countArtifacts(ctx).catch(() => null);
        if (n === null) return { enabled: true, state: 'attention', detail: 'Unavailable' };
        return { enabled: true, state: 'active', detail: m.sysagent_builder_status({ n }) };
      },
      async resolveVariables(ctx, keys) {
        const out: Record<string, unknown> = {};
        if (keys.includes('artifacts.builtCount')) out['artifacts.builtCount'] = await countArtifacts(ctx).catch(() => 0);
        if (keys.includes('artifacts.recent')) out['artifacts.recent'] = await listRecentArtifacts(ctx).catch(() => []);
        return out;
      },
    },
```
Import `countArtifacts`, `listRecentArtifacts` from `$lib/server/artifacts/store`.

- [ ] **Step 4: Verify + commit** — `bun run i18n:compile && bun run check` 0; flow test (if `agent-flows.test.ts` iterates AGENT_FLOWS, ensure it passes).
```bash
git add src/lib/server/system-agents/registry.ts src/lib/flows/master-flows.ts messages/en.json messages/es.json
git -c commit.gpgsign=false commit -m "feat(agents): artifact-builder system agent (admin-only) + representative flow"
```

---

### Task 4: Dashboard artifact — descriptor + bundle + serving + context

**Files:** Modify `src/lib/agents/artifacts.ts`, `src/lib/agents/artifacts.test.ts`, `src/lib/server/artifacts/registry.ts`, `src/routes/artifacts/[artifactId]/ui/[...path]/+server.ts`, `messages/en.json`, `messages/es.json`; Create `src/lib/artifacts/builtin/artifact-builder/index.html`.

- [ ] **Step 1: i18n (artifact)** — both locales: `artifact_builder_title` ("Builder activity"/"Actividad del constructor"), `artifact_builder_desc` ("Artifacts built + recent generations."/"Artefactos creados y generaciones recientes.").

- [ ] **Step 2: Descriptor** — in `artifacts.ts` add:
```ts
export function artifactBuilderDescriptorFor(agentId: string, title: string, description: string): ArtifactDescriptor {
  return { id: 'builder', agentId, slot: 'detail', title, description, icon: 'Sparkles', kind: 'static', entrypoint: 'index.html' };
}
```
(Confirm `Sparkles` is in `PLUGIN_ICON_MAP`; if not, add it there or use an existing one like `Wand2`/`LayoutDashboard`.) Add a test in `artifacts.test.ts` (id `builder`, icon, static).

- [ ] **Step 3: Registry** — in `server/artifacts/registry.ts` `getArtifactsForAgent`: for `agentId === 'artifact-builder'` return `[artifactBuilderDescriptorFor(agentId, m.artifact_builder_title(), m.artifact_builder_desc())]` (no DB-merge for this agent). In `getArtifactContext`: for `agentId==='artifact-builder' && artifactId==='builder'` → return `withVars(ctx, agentId, base)` (the existing `withVars` already calls the descriptor's `resolveVariables` → sets `vars` with builtCount/recent; ensure the builder's flow exports those keys OR have `withVars` pass the keys the dashboard needs). If `withVars` only resolves *exported* flow vars, simplest: directly set `vars` here via `resolveVariables(['artifacts.builtCount','artifacts.recent'])` on the descriptor. Implement whichever matches `withVars`'s contract (read it first).

- [ ] **Step 4: Bundle** — `src/lib/artifacts/builtin/artifact-builder/index.html`: copy overview's bridge `<script>` VERBATIM; render `context.vars['artifacts.builtCount']` as a stat + `context.vars['artifacts.recent']` (array of {title, agentId, version, updatedAt}) as a list (title • agent • v{version} • relative time). Token-bound, loading/empty/error states. Register in `BUNDLES`: `import builderHtml from '$lib/artifacts/builtin/artifact-builder/index.html?raw'` + `builder: { 'index.html': { body: builderHtml, type: 'text/html; charset=utf-8' } }`.

- [ ] **Step 5: Validate + verify** — Svelte autofixer N/A (HTML); `bun run i18n:compile && bun run check` 0; `bun run test -- src/lib/agents/artifacts.test.ts` green.

- [ ] **Step 6: Commit**
```bash
git add src/lib/agents/artifacts.ts src/lib/agents/artifacts.test.ts src/lib/server/artifacts/registry.ts "src/routes/artifacts/[artifactId]/ui/[...path]/+server.ts" src/lib/artifacts/builtin/artifact-builder/index.html messages/en.json messages/es.json
git -c commit.gpgsign=false commit -m "feat(artifacts): artifact-builder dashboard artifact (built-count + recent)"
```

---

### Task 5: Full verification

- [ ] **Step 1:** `bun run i18n:compile && bun run check` → 0/0; `bun run test` → green (artifacts + flow tests; no NEW failures).
- [ ] **Step 2: Live (best-effort)** — admin: an **Artifact Builder** card shows in `/agents/autonomous` (status "N artifacts built"), its flow opens read-only, its dashboard shows built-count + recent; non-admin: card absent + detail URL 404s. If no instance, note deferred.
- [ ] **Step 3:** Commit any fixes.

---

## Self-Review

**Spec coverage:** adminOnly flag + roster filter + detail 404 (T1) ✓; countArtifacts/listRecentArtifacts org-scoped (T2) ✓; builder descriptor (adminOnly, resolveStatus, resolveVariables) + flow + agent i18n (T3) ✓; dashboard descriptor + bundle + serving + context vars + artifact i18n (T4) ✓; no `+` on builder (getArtifactsForAgent returns only the dashboard, no DB-merge; gallery `canAdd` is per-card — builder card isn't special-cased to add) ✓; no new migration ✓. Out-of-scope (5c.3 async) absent.

**Placeholder scan:** none — complete code/commands. T4 step 3 says "read `withVars` first" — a real grounding step (its exact contract decides whether to set vars directly or via exports), with both paths specified.

**Type consistency:** `adminOnly` (T1) on meta+VM, read by roster/detail (T1). `countArtifacts`/`listRecentArtifacts` (T2) consumed by the descriptor (T3) + context (T4). `artifactBuilderDescriptorFor` (T4) consumed by `getArtifactsForAgent` (T4). Builder `flowId` `agent-artifact-builder` (T3) matches the AGENT_FLOWS id. Bundle `builder` id matches the descriptor id + the BUNDLES key + the context branch.
