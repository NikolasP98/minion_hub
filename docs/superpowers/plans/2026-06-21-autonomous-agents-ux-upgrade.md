# Autonomous Agents UX upgrade — Implementation Plan (Phases 1–3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Upgrade autonomous-agent cards (animated status dot + kebab menu), add native health metric blocks + an embedded view-only flow to the detail page, with an admin-gated EDIT hook.

**Architecture:** Pure Svelte 5 components + one server helper. Reuse shared `Dropdown`, `MasterFlowCanvas`, `fmtTimeAgo`. Health metrics derive from `flow_runs` (DB-flow agents) with a `status.stats` fallback. No new artifact, no migration, no new dependency.

**Tech Stack:** SvelteKit 2, Svelte 5 runes, Tailwind 4, Drizzle (pg), Paraglide i18n, Vitest.

## Global Constraints
- `bun run check` → 0 errors / 0 warnings; `bun run test` green. (verbatim: repo is fully green, keep it green)
- Svelte 5 only (runes, snippets, `onclick=`). No new npm dependency.
- i18n: every user-facing string via `$lib/paraglide/messages` (`m.*`), keys added to BOTH `messages/en.json` and `messages/es.json`, then `bun run i18n:compile`.
- Work on `dev` (clean, dev==master). Commit per task, `git -c commit.gpgsign=false`, exclude package-lock.

---

### Task 1: `StatusDot` shared component

**Files:**
- Create: `src/lib/components/ui/StatusDot.svelte`
- Modify: `src/lib/components/ui/index.ts` (barrel export)

**Interfaces:**
- Produces: `StatusDot` — props `{ state: 'active'|'attention'|'disabled'; label: string }`. A colored dot that expands on hover/focus to reveal `label`.

- [ ] **Step 1: Create the component**

```svelte
<script lang="ts">
  let { state, label }: { state: 'active' | 'attention' | 'disabled'; label: string } = $props();

  const dot = $derived(
    state === 'active' ? 'bg-emerald-400' : state === 'attention' ? 'bg-amber-400' : 'bg-white/30',
  );
  const text = $derived(
    state === 'active' ? 'text-emerald-300' : state === 'attention' ? 'text-amber-300' : 'text-white/50',
  );
</script>

<!-- Dot expands on hover/focus to reveal the label. Label is always in the DOM
     (collapsed via max-width) so screen readers and keyboard users get it. -->
<span
  class="group/sd inline-flex items-center gap-1.5 rounded-full bg-white/[0.04] px-1.5 py-0.5 ring-1 ring-white/10 outline-none"
  tabindex="0"
  role="status"
  aria-label={label}
>
  <span class="size-2 shrink-0 rounded-full {dot}"></span>
  <span
    class="sd-label max-w-0 overflow-hidden whitespace-nowrap text-[11px] font-medium opacity-0 transition-all duration-200 group-hover/sd:max-w-[10rem] group-hover/sd:opacity-100 group-focus-within/sd:max-w-[10rem] group-focus-within/sd:opacity-100 {text}"
  >{label}</span>
</span>

<style>
  @media (prefers-reduced-motion: reduce) {
    .sd-label { transition: none; }
  }
</style>
```

- [ ] **Step 2: Export from the barrel**

In `src/lib/components/ui/index.ts`, add alongside the other exports:
```ts
export { default as StatusDot } from './StatusDot.svelte';
```

- [ ] **Step 3: Verify**

Run: `bun run check`
Expected: `0 ERRORS 0 WARNINGS`.

- [ ] **Step 4: Commit**

```bash
git add src/lib/components/ui/StatusDot.svelte src/lib/components/ui/index.ts
git -c commit.gpgsign=false commit -m "feat(ui): StatusDot — colored status dot that expands to label on hover/focus"
```

---

### Task 2: Card — adopt StatusDot + kebab menu (`AutonomousAgentCard.svelte`)

**Files:**
- Modify: `src/lib/components/agents/AutonomousAgentCard.svelte`

**Interfaces:**
- Consumes: `StatusDot` (Task 1); shared `Dropdown` + `DropdownItem` from `$lib/components/ui`.

- [ ] **Step 1: Swap imports**

In the `<script>`: remove the now-unused `Settings2, Workflow` lucide imports if only used by the old buttons (keep `Zap`); add:
```ts
import { Zap, MoreVertical, Workflow, Settings2 } from 'lucide-svelte';
import { StatusDot, Dropdown, type DropdownItem } from '$lib/components/ui';
```

- [ ] **Step 2: Replace `statusTone` with a kebab items derivation**

Delete the `statusTone` `$derived` block. Add:
```ts
const menuItems = $derived<DropdownItem[]>([
  ...(agent.flowId ? [{ value: 'view-flow', label: m.autonomous_view_flow(), icon: Workflow }] : []),
  { value: 'manage', label: m.autonomous_manage(), icon: Settings2 },
]);

function onMenu(value: string) {
  if (value === 'view-flow' && agent.flowId) agentWindows.openFlow(agent.flowId, agent.name);
  else if (value === 'manage') goto(`/agents/autonomous/${encodeURIComponent(agent.id)}`);
}
```

- [ ] **Step 3: Replace the header status pill with StatusDot + kebab**

Replace the `<span ... {statusTone}>{statusLabel}</span>` block in `<header>` with:
```svelte
<div class="flex shrink-0 items-center gap-1">
  <StatusDot state={agent.status.state} label={statusLabel} />
  <Dropdown items={menuItems} onSelect={onMenu} placement="bottom">
    {#snippet trigger()}
      <span
        class="grid size-7 place-items-center rounded-lg text-white/50 transition-colors hover:bg-white/[0.06] hover:text-white"
        aria-label={m.autonomous_manage()}
      >
        <MoreVertical size={15} />
      </span>
    {/snippet}
  </Dropdown>
</div>
```

- [ ] **Step 4: Remove the footer action buttons**

In `<footer>`, delete the `<div class="flex items-center gap-2">…</div>` that held the View flow + Manage buttons. Keep the stats `<span>`. The footer becomes just the stats line (drop `justify-between`; use a plain block).

- [ ] **Step 5: Verify**

Run: `bun run check`
Expected: `0 ERRORS 0 WARNINGS` (no unused-import warnings — verify `Settings2`/`Workflow` are still referenced by `menuItems`).

- [ ] **Step 6: Commit**

```bash
git add src/lib/components/agents/AutonomousAgentCard.svelte
git -c commit.gpgsign=false commit -m "feat(agents): card status dot + 3-dot kebab (View flow / Manage)"
```

---

### Task 3: `getHealthMetrics` server helper + test

> **Dependency:** do **Task 4** (adds `dbFlowId` to `AutonomousAgentVM`) FIRST — this helper reads `agent.dbFlowId`, which won't type-check until that field exists.

**Files:**
- Create: `src/lib/server/agents/health-metrics.ts`
- Test: `src/lib/server/agents/health-metrics.test.ts`

**Interfaces:**
- Consumes: `flowRuns` from `$server/db/pg-schema/flows`, `getCoreDb`, `withOrgCore`, `CoreCtx`, `AutonomousAgentVM`.
- Produces: `getHealthMetrics(ctx: CoreCtx, agent: AutonomousAgentVM, now?: number): Promise<HealthMetrics>` where `HealthMetrics = { state; lastRunAt: number|null; runs30d: number|null; successRate: number|null }`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi } from 'vitest';

const tx = { select: vi.fn() };
vi.mock('$server/db/pg-client', () => ({ getCoreDb: () => ({}) }));
vi.mock('$server/db/with-org-core', () => ({
  withOrgCore: (_s: unknown, fn: (t: typeof tx) => unknown) => fn(tx),
}));

import { getHealthMetrics } from './health-metrics';

function vm(over: Record<string, unknown> = {}) {
  return { id: 'a', name: 'A', status: { enabled: true, state: 'active' }, ...over } as never;
}
const ctx = { tenantId: 'org1' } as never;

describe('getHealthMetrics', () => {
  it('DB-flow agent: derives from flow_runs', async () => {
    tx.select.mockReturnValue({
      from: () => ({ where: () => Promise.resolve([{ total: 4, ok: 3, last: 1000 }]) }),
    });
    const m = await getHealthMetrics(ctx, vm({ dbFlowId: 'f1' }), 5000);
    expect(m).toEqual({ state: 'active', lastRunAt: 1000, runs30d: 4, successRate: 0.75 });
  });

  it('stats fallback: derives from status.stats', async () => {
    const m = await getHealthMetrics(ctx, vm({ status: { enabled: true, state: 'active', stats: { sent: 8, failed: 2, skipped: 5 } } }));
    expect(m).toEqual({ state: 'active', lastRunAt: null, runs30d: 15, successRate: 0.8 });
  });

  it('no data: all null', async () => {
    const m = await getHealthMetrics(ctx, vm({ status: { enabled: false, state: 'disabled' } }));
    expect(m).toEqual({ state: 'disabled', lastRunAt: null, runs30d: null, successRate: null });
  });
});
```

- [ ] **Step 2: Run it — verify it fails**

Run: `bun run vitest run src/lib/server/agents/health-metrics.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

```ts
import { and, eq, gte, sql } from 'drizzle-orm';
import { getCoreDb } from '$server/db/pg-client';
import { withOrgCore } from '$server/db/with-org-core';
import { flowRuns } from '$server/db/pg-schema/flows';
import type { CoreCtx } from '$server/auth/core-ctx';
import type { AutonomousAgentVM } from '$lib/agents/autonomous';

export type HealthMetrics = {
  state: 'active' | 'attention' | 'disabled';
  lastRunAt: number | null;
  runs30d: number | null;
  successRate: number | null;
};

const MS_30D = 30 * 24 * 60 * 60 * 1000;

export async function getHealthMetrics(
  ctx: CoreCtx,
  agent: AutonomousAgentVM,
  now: number = Date.now(),
): Promise<HealthMetrics> {
  const state = agent.status.state;

  if (agent.dbFlowId) {
    const since = now - MS_30D;
    return withOrgCore({ db: getCoreDb(), tenantId: ctx.tenantId }, async (tx) => {
      const rows = await tx
        .select({
          total: sql<number>`count(*)::int`,
          ok: sql<number>`count(*) filter (where ${flowRuns.status} = 'completed')::int`,
          last: sql<number | null>`max(${flowRuns.startedAt})`,
        })
        .from(flowRuns)
        .where(
          and(
            eq(flowRuns.flowId, agent.dbFlowId!),
            eq(flowRuns.tenantId, ctx.tenantId),
            gte(flowRuns.startedAt, since),
          ),
        );
      const r = rows[0] ?? { total: 0, ok: 0, last: null };
      const total = Number(r.total ?? 0);
      return {
        state,
        lastRunAt: r.last != null ? Number(r.last) : null,
        runs30d: total,
        successRate: total > 0 ? Number(r.ok ?? 0) / total : null,
      };
    });
  }

  const stats = agent.status.stats;
  if (stats) {
    const denom = stats.sent + stats.failed;
    return {
      state,
      lastRunAt: null,
      runs30d: stats.sent + stats.failed + stats.skipped,
      successRate: denom > 0 ? stats.sent / denom : null,
    };
  }

  return { state, lastRunAt: null, runs30d: null, successRate: null };
}
```

- [ ] **Step 4: Run the test — verify pass**

Run: `bun run vitest run src/lib/server/agents/health-metrics.test.ts`
Expected: PASS (3/3).

- [ ] **Step 5: Commit**

```bash
git add src/lib/server/agents/health-metrics.ts src/lib/server/agents/health-metrics.test.ts
git -c commit.gpgsign=false commit -m "feat(agents): getHealthMetrics (flow_runs + status.stats fallback) + tests"
```

---

### Task 4: `dbFlowId` field on the VM/meta types

**Files:**
- Modify: `src/lib/agents/autonomous.ts`

**Interfaces:**
- Produces: optional `dbFlowId?: string` on `AutonomousAgentVM` and `SystemAgentMeta`; threaded through `systemMetaToVM`.

- [ ] **Step 1: Add the field**

In `src/lib/agents/autonomous.ts`, add `dbFlowId?: string;` to both the `SystemAgentMeta` interface and the `AutonomousAgentVM` interface (next to `flowId?`). In `systemMetaToVM(meta, status)`, add `dbFlowId: meta.dbFlowId,` to the returned object (next to `flowId: meta.flowId`).

- [ ] **Step 2: Verify**

Run: `bun run check`
Expected: `0 ERRORS 0 WARNINGS` (existing system metas omit `dbFlowId` → `undefined`, valid for an optional field).

- [ ] **Step 3: Commit**

```bash
git add src/lib/agents/autonomous.ts
git -c commit.gpgsign=false commit -m "feat(agents): optional dbFlowId on autonomous VM/meta (gates EDIT, drives health metrics)"
```

---

### Task 5: `AgentHealthMetrics` component + i18n

**Files:**
- Create: `src/lib/components/agents/AgentHealthMetrics.svelte`
- Modify: `messages/en.json`, `messages/es.json`

**Interfaces:**
- Consumes: `HealthMetrics` (Task 3), `StatusDot` (Task 1), `fmtTimeAgo` from `$lib/utils/format`.
- Produces: `AgentHealthMetrics` — prop `{ health: HealthMetrics }`; a row of 4 metric blocks.

- [ ] **Step 1: Add i18n keys**

In `messages/en.json` (and Spanish equivalents in `messages/es.json`):
```
"agent_health_status": "Status",
"agent_health_last_run": "Last run",
"agent_health_runs_30d": "Runs (30d)",
"agent_health_success": "Success rate"
```
es:
```
"agent_health_status": "Estado",
"agent_health_last_run": "Última ejecución",
"agent_health_runs_30d": "Ejecuciones (30d)",
"agent_health_success": "Tasa de éxito"
```

- [ ] **Step 2: Create the component**

```svelte
<script lang="ts">
  import * as m from '$lib/paraglide/messages';
  import { StatusDot } from '$lib/components/ui';
  import { fmtTimeAgo } from '$lib/utils/format';
  import type { HealthMetrics } from '$lib/server/agents/health-metrics';

  let { health }: { health: HealthMetrics } = $props();

  const stateLabel = $derived(
    health.state === 'active'
      ? m.autonomous_status_active()
      : health.state === 'attention'
        ? m.autonomous_status_attention()
        : m.autonomous_status_disabled(),
  );
  const lastRun = $derived(health.lastRunAt != null ? fmtTimeAgo(health.lastRunAt) : '—');
  const runs = $derived(health.runs30d != null ? String(health.runs30d) : '—');
  const success = $derived(health.successRate != null ? `${Math.round(health.successRate * 100)}%` : '—');
</script>

<div class="grid grid-cols-2 gap-3 sm:grid-cols-4">
  <div class="rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2.5">
    <p class="mb-1 text-[10px] font-medium uppercase tracking-wide text-white/40">{m.agent_health_status()}</p>
    <StatusDot state={health.state} label={stateLabel} />
  </div>
  {#each [[m.agent_health_last_run(), lastRun], [m.agent_health_runs_30d(), runs], [m.agent_health_success(), success]] as [label, value] (label)}
    <div class="rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2.5">
      <p class="mb-1 text-[10px] font-medium uppercase tracking-wide text-white/40">{label}</p>
      <p class="text-base font-semibold text-white">{value}</p>
    </div>
  {/each}
</div>
```

- [ ] **Step 3: Compile i18n + verify**

Run: `bun run i18n:compile && bun run check`
Expected: `0 ERRORS 0 WARNINGS`.

- [ ] **Step 4: Commit**

```bash
git add src/lib/components/agents/AgentHealthMetrics.svelte messages/en.json messages/es.json src/lib/paraglide
git -c commit.gpgsign=false commit -m "feat(agents): AgentHealthMetrics 4-block component + i18n"
```

---

### Task 6: Detail page — load health, render metrics + embedded view-only flow + EDIT gate

**Files:**
- Modify: `src/routes/(app)/agents/autonomous/[id]/+page.server.ts`
- Modify: `src/routes/(app)/agents/autonomous/[id]/+page.svelte`
- Modify: `messages/en.json`, `messages/es.json` (EDIT label)

**Interfaces:**
- Consumes: `getHealthMetrics` (Task 3), `AgentHealthMetrics` (Task 5), `MasterFlowCanvas`, `getMasterFlow`, `HealthMetrics`.

- [ ] **Step 1: Load health in the server loader**

In `+page.server.ts`, import `getHealthMetrics`, and add `health` to the returned object:
```ts
import { getHealthMetrics } from '$lib/server/agents/health-metrics';
// …in load(), after `agent` is resolved:
const health = await getHealthMetrics(ctx, agent);
return { agent, artifacts: await getArtifactsForAgent(ctx, agent.id), isAdmin, flowTogglesByFlow, health };
```

- [ ] **Step 2: Add the EDIT i18n key**

`messages/en.json`: `"autonomous_edit_flow": "Edit"` · `messages/es.json`: `"autonomous_edit_flow": "Editar"`.

- [ ] **Step 3: Render metrics + flow on the detail page**

In `+page.svelte`, import:
```ts
import AgentHealthMetrics from '$lib/components/agents/AgentHealthMetrics.svelte';
import MasterFlowCanvas from '$lib/components/flow-editor/MasterFlowCanvas.svelte';
import { getMasterFlow } from '$lib/flows/master-flows';
import { Pencil } from 'lucide-svelte';
import type { HealthMetrics } from '$lib/server/agents/health-metrics';
```
Widen the props type: `data: { agent: AutonomousAgentVM; artifacts: ArtifactDescriptor[]; isAdmin: boolean; health: HealthMetrics }`.
Add a derived flow: `const flow = $derived(agent.flowId ? getMasterFlow(agent.flowId) : undefined);`

Between the `</header>` and the `<div class="grid …">` artifact block, insert:
```svelte
<!-- Health metrics -->
<div class="mb-4">
  <AgentHealthMetrics health={data.health} />
</div>

<!-- View-only flow -->
{#if flow}
  <section class="mb-4 rounded-xl border border-white/10 bg-white/[0.02]">
    <div class="flex items-center justify-between border-b border-white/10 px-4 py-2.5">
      <p class="text-[10px] font-medium uppercase tracking-wide text-white/40">{m.autonomous_view_flow()}</p>
      {#if data.isAdmin && agent.dbFlowId}
        <a
          href={`/flow-editor/${agent.dbFlowId}`}
          class="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1 text-xs font-medium text-white/80 hover:bg-white/10"
        >
          <Pencil size={13} /> {m.autonomous_edit_flow()}
        </a>
      {/if}
    </div>
    <div class="h-80">
      <MasterFlowCanvas {flow} />
    </div>
  </section>
{/if}
```

- [ ] **Step 4: Compile + verify**

Run: `bun run i18n:compile && bun run check`
Expected: `0 ERRORS 0 WARNINGS`.

- [ ] **Step 5: Commit**

```bash
git add "src/routes/(app)/agents/autonomous/[id]/+page.server.ts" "src/routes/(app)/agents/autonomous/[id]/+page.svelte" messages/en.json messages/es.json src/lib/paraglide
git -c commit.gpgsign=false commit -m "feat(agents): detail page — health metric blocks + embedded view-only flow + admin EDIT gate"
```

---

## Final verification
- [ ] `bun run check` → 0/0/0
- [ ] `bun run test` → green (incl. new health-metrics test)
- [ ] Manual via `:5173` HMR: card dot expands on hover, kebab opens View flow/Manage; detail page shows 4 metric blocks (reminders shows real sent/failed-derived numbers; last-run "—") + embedded pan/zoom flow; no EDIT button on the 3 system agents (no dbFlowId).

## Self-review notes
- Spec coverage: P1 (T1,T2), P2 (T3,T5,T6-load+render), P3 (T4 dbFlowId, T6 flow embed+EDIT gate). ✓
- `dbFlowId` defined in T4 before use in T3 test (mock) / T6 — consumers reference the same field name. ✓
- No placeholders; all code shown. Health metric arithmetic tested (T3). Components are svelte-check-verified.
