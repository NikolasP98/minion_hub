# Autonomous Card Artifact Gallery + Flow Association (Phase 1.5) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a per-card **artifact gallery** (icon tiles + popovers + admin-stub "+") and a per-agent **representative flow** ("View flow" → read-only graph editor) to the autonomous agents surface.

**Architecture:** Extend the pure artifact descriptor with `icon`/`description`; a new `ArtifactGallery` renders icon tiles (shared `Popover`) and opens artifacts in the shared `Modal` (reusing the live `ArtifactHost`); the roster load supplies per-agent artifacts + an admin flag. Representative flows reuse the existing read-only master-flow viewer (`/flow-editor/master/[id]`) via a new `AGENT_FLOWS` list and a `flowId` on the agent VM.

**Tech Stack:** SvelteKit 2, Svelte 5 (runes), TypeScript (strict), Tailwind 4, Paraglide i18n, Vitest, Bun. Reuses `$lib/components/ui` `Popover`/`Modal`, `$lib/plugins/icon-map` `resolvePluginIcon`, `$lib/flows/master-flows.ts`, and the merged `ArtifactHost`.

## Global Constraints

- Svelte 5 runes only (`$props`, `$state`, `$derived`, `onMount`, `onclick={}`). No legacy Svelte 4. Dynamic icon render uses `{@const Icon = …}` + `<Icon/>` (not deprecated `<svelte:component>`).
- TypeScript strict; no `any`; never `@ts-nocheck`.
- i18n: every user-facing string in BOTH `messages/en.json` and `messages/es.json`; run `bun run i18n:compile` before `bun run check`.
- Validate every `.svelte` with the Svelte MCP autofixer (ToolSearch `select:mcp__plugin_svelte_svelte__svelte-autofixer`) before committing.
- Verify: `bun run check` 0/0; `bun run test` green. Commits UNSIGNED (`git -c commit.gpgsign=false`); never `git add` a lockfile.
- Representative flows are READ-ONLY (master-flow viewer) and must be **true to real functionality**.

## Reference: current shapes (verified)

- `ArtifactDescriptor` = `{ id; agentId; slot:'detail'; title; kind:'static'; entrypoint }` (`src/lib/agents/artifacts.ts`). `overviewDescriptorFor(agentId, title)`.
- `SystemAgentMeta` = `{ id; moduleId; name; role; description; avatarSeed; trigger; managePath }`; `AutonomousAgentVM` = `{ id; source; name; role; description; avatarUrl; trigger; managePath; status }` (`src/lib/agents/autonomous.ts`). `systemMetaToVM(meta,status)` maps meta→VM; `gatewayAgentToVM(agent,archetype)`.
- `MasterFlow` = `{ id; name; description; tags?; nodes: MasterFlowNode[]; edges: MasterFlowEdge[] }`; `MasterFlowNode` = `{ id; kind: MasterNodeKind; title; subtitle?; position; branches? }`; `MasterFlowEdge` = `{ id; source; target; sourceHandle?; label?; variant? }`; `at(col, lane=0)` layout helper; `MASTER_FLOWS: MasterFlow[]`; `getMasterFlow(id)` (`src/lib/flows/master-flows.ts`). `MasterNodeKind` includes `trigger|schedule|process|llm|agent|channel|end|…`.
- `Popover` props: `{ trigger: Snippet; children: Snippet; open?: boolean; placement? }`. `Modal` props: `{ open?: boolean; title?: string; onclose?: () => void; header?/children?/footer?: Snippet }`.
- `resolvePluginIcon(name?): LucideIcon | string` from `PLUGIN_ICON_MAP` in `src/lib/plugins/icon-map.ts` (returns `Puzzle` for unknown).
- Admin: `locals.user?.role === 'admin'` (`role: 'user'|'admin'` in `src/app.d.ts`).
- Roster load `src/routes/(app)/agents/autonomous/+page.server.ts` returns `{ systemAgents }` via `requireCoreCtx` + `loadSystemAgentVMs`.

---

### Task 1: ArtifactDescriptor gains icon + description

**Files:**
- Modify: `src/lib/agents/artifacts.ts`
- Modify: `src/lib/agents/artifacts.test.ts`

**Interfaces — Produces:** `ArtifactDescriptor` with `icon: string` + `description: string`; `overviewDescriptorFor(agentId: string, title: string, description: string)`.

- [ ] **Step 1: Update the test (TDD)** — in `src/lib/agents/artifacts.test.ts`, replace the `overviewDescriptorFor` test with:

```ts
describe('overviewDescriptorFor', () => {
  it('builds the overview descriptor with icon + description', () => {
    expect(overviewDescriptorFor('scheduling.reminders', 'Overview', 'Live status & activity.')).toEqual({
      id: 'overview',
      agentId: 'scheduling.reminders',
      slot: 'detail',
      title: 'Overview',
      description: 'Live status & activity.',
      icon: 'LayoutDashboard',
      kind: 'static',
      entrypoint: 'index.html',
    });
  });
});
```

- [ ] **Step 2: Run it red** — `bun run test -- src/lib/agents/artifacts.test.ts` → FAIL (signature/shape mismatch).

- [ ] **Step 3: Implement** — in `src/lib/agents/artifacts.ts`, add the two fields and update the factory:

```ts
export interface ArtifactDescriptor {
  id: string;
  agentId: string;
  slot: 'detail';
  title: string;
  description: string;   // shown in the gallery tile popover
  icon: string;          // lucide icon name (resolved via resolvePluginIcon)
  kind: 'static';
  entrypoint: string;
}

/** The built-in "overview" artifact, attached to any agent. Strings are localized by the caller. */
export function overviewDescriptorFor(agentId: string, title: string, description: string): ArtifactDescriptor {
  return { id: 'overview', agentId, slot: 'detail', title, description, icon: 'LayoutDashboard', kind: 'static', entrypoint: 'index.html' };
}
```

- [ ] **Step 4: Run it green** — `bun run test -- src/lib/agents/artifacts.test.ts` → PASS.

- [ ] **Step 5: Commit**
```bash
git add src/lib/agents/artifacts.ts src/lib/agents/artifacts.test.ts
git -c commit.gpgsign=false commit -m "feat(artifacts): add icon + description to ArtifactDescriptor"
```

> Note: `getArtifactContext`/`agentVmToArtifactContext` are unaffected (they read other fields). The registry call site (`overviewDescriptorFor`) is updated in Task 6's load wiring — but registry.ts calls it; see Task 2.

---

### Task 2: flowId plumbing (agent VM + Reminders) + overview description

**Files:**
- Modify: `src/lib/agents/autonomous.ts`
- Modify: `src/lib/server/system-agents/registry.ts`
- Modify: `src/lib/server/artifacts/registry.ts`
- Modify: `messages/en.json`, `messages/es.json`

**Interfaces:** `SystemAgentMeta` + `AutonomousAgentVM` gain `flowId?: string`; `systemMetaToVM` carries it; Reminders descriptor sets `flowId: 'agent-reminders'`; `getArtifactsForAgent` passes a localized description to `overviewDescriptorFor`.

- [ ] **Step 1: Add `flowId` to the types + mapper** — in `src/lib/agents/autonomous.ts`:
  - add `flowId?: string;` to `interface SystemAgentMeta` (after `managePath`)
  - add `flowId?: string;` to `interface AutonomousAgentVM` (after `managePath`)
  - in `systemMetaToVM`, add `flowId: meta.flowId,` to the returned object
  - (`gatewayAgentToVM` leaves `flowId` unset — gateway agents have no representative flow yet)

- [ ] **Step 2: Set Reminders `flowId`** — in `src/lib/server/system-agents/registry.ts`, in the Reminders descriptor object, add:
```ts
      flowId: 'agent-reminders',
```

- [ ] **Step 3: Add overview-description i18n + pass it** — add to `messages/en.json`: `"artifact_overview_desc": "Live status, role, and recent activity.",` ; `messages/es.json`: `"artifact_overview_desc": "Estado, rol y actividad reciente.",`. Then in `src/lib/server/artifacts/registry.ts`, update `getArtifactsForAgent`:
```ts
export function getArtifactsForAgent(agentId: string): ArtifactDescriptor[] {
  return [overviewDescriptorFor(agentId, m.artifact_overview_title(), m.artifact_overview_desc())];
}
```

- [ ] **Step 4: Verify** — `bun run i18n:compile && bun run check` → 0 errors. (`autonomous.test.ts` builds VMs; the optional `flowId` doesn't break existing assertions. If a `toEqual` on a VM now fails because `flowId` is present-as-undefined, change it to `toMatchObject` or add `flowId: undefined` — fix inline.)

- [ ] **Step 5: Commit**
```bash
git add src/lib/agents/autonomous.ts src/lib/server/system-agents/registry.ts src/lib/server/artifacts/registry.ts messages/en.json messages/es.json
git -c commit.gpgsign=false commit -m "feat(agents): flowId on agent VM + Reminders; localized overview description"
```

---

### Task 3: Representative agent flow (Reminders) via master-flow viewer

**Files:**
- Modify: `src/lib/flows/master-flows.ts`
- Create: `src/lib/flows/agent-flows.test.ts`

**Interfaces:** `AGENT_FLOWS: MasterFlow[]` (representative per-agent flows, NOT in the listed `MASTER_FLOWS`); `getMasterFlow(id)` resolves `MASTER_FLOWS ∪ AGENT_FLOWS`.

- [ ] **Step 1: Write the failing test** — `src/lib/flows/agent-flows.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { getMasterFlow, MASTER_FLOWS } from './master-flows';

describe('agent representative flows', () => {
  it('resolves the Reminders agent flow by id', () => {
    const flow = getMasterFlow('agent-reminders');
    expect(flow).toBeTruthy();
    expect(flow?.name).toMatch(/reminder/i);
    expect((flow?.nodes.length ?? 0)).toBeGreaterThanOrEqual(4);
  });
  it('does not list agent flows in the master-flows roster', () => {
    expect(MASTER_FLOWS.some((f) => f.id === 'agent-reminders')).toBe(false);
  });
});
```

- [ ] **Step 2: Run it red** — `bun run test -- src/lib/flows/agent-flows.test.ts` → FAIL (`getMasterFlow('agent-reminders')` undefined).

- [ ] **Step 3: Implement** — in `src/lib/flows/master-flows.ts`, after the `MASTER_FLOWS` definition, add the representative Reminders flow (true to its real cron→due→compose→send→ledger pipeline) and extend the lookup:

```ts
// ── Representative per-autonomous-agent flows ────────────────────────────────
// Read-only diagrams of what each system agent actually does. Resolvable via
// /flow-editor/master/<id> but intentionally NOT in MASTER_FLOWS (so they don't
// clutter the master-flows roster). True to the real implementation.
const remindersAgentFlow: MasterFlow = {
  id: 'agent-reminders',
  name: 'Reminders agent',
  description:
    'How the Reminders autonomous agent works: an external cron tick scans upcoming bookings, finds due reminder stages (confirmation / 24h / 2h), composes a personalized Spanish WhatsApp message, sends it via the gateway, and mirrors it into the CRM messages ledger. Reconstructed from the hub reminders service.',
  tags: ['autonomous', 'scheduling', 'whatsapp'],
  nodes: [
    { id: 'tick', kind: 'schedule', title: 'Cron tick (every minute)', subtitle: 'external scheduler → /api/scheduling/reminders/tick (CRON_SECRET)', position: at(0) },
    { id: 'enabled', kind: 'guard', title: 'Reminders enabled for org?', subtitle: 'sched_reminder_config.enabled · else skip', position: at(1), branches: [{ id: 'on', label: 'Enabled' }, { id: 'off', label: 'Disabled' }] },
    { id: 'due', kind: 'process', title: 'Find due stages', subtitle: '60-day booking horizon · dueStages(confirmation/24h/2h) · claim-first dedupe', position: at(2) },
    { id: 'optout', kind: 'guard', title: 'Recipient opted out?', subtitle: 'crm_contacts.custom_fields._reminders_opt_out', position: at(3), branches: [{ id: 'ok', label: 'OK' }, { id: 'skip', label: 'Opted out' }] },
    { id: 'compose', kind: 'llm', title: 'Compose reminder (LLM)', subtitle: 'OpenRouter · personalized Spanish · template fallback', position: at(4) },
    { id: 'send', kind: 'channel', title: 'Send WhatsApp', subtitle: "gatewayCall('channels.send') · idempotencyKey rem-{booking}-{stage}", position: at(5) },
    { id: 'ledger', kind: 'memory', title: 'Mirror to messages ledger', subtitle: 'insertMessages → shows in CRM timeline', position: at(6) },
    { id: 'done', kind: 'end', title: 'Recorded', subtitle: 'sched_reminders row: sent / failed / skipped', position: at(7) },
  ],
  edges: [
    { id: 'e-tick-enabled', source: 'tick', target: 'enabled' },
    { id: 'e-enabled-due', source: 'enabled', target: 'due', sourceHandle: 'on' },
    { id: 'e-due-optout', source: 'due', target: 'optout' },
    { id: 'e-optout-compose', source: 'optout', target: 'compose', sourceHandle: 'ok' },
    { id: 'e-compose-send', source: 'compose', target: 'send' },
    { id: 'e-send-ledger', source: 'send', target: 'ledger' },
    { id: 'e-ledger-done', source: 'ledger', target: 'done' },
  ],
};

export const AGENT_FLOWS: MasterFlow[] = [remindersAgentFlow];
```

Then change `getMasterFlow` to also search `AGENT_FLOWS`:
```ts
export function getMasterFlow(id: string): MasterFlow | undefined {
  return MASTER_FLOWS.find((f) => f.id === id) ?? AGENT_FLOWS.find((f) => f.id === id);
}
```
(Confirm `guard`/`schedule`/`memory`/`channel`/`llm`/`process`/`end` are valid `MasterNodeKind` values; if a kind is absent from the union, swap to the nearest existing kind — do NOT invent a kind.)

- [ ] **Step 4: Run it green** — `bun run test -- src/lib/flows/agent-flows.test.ts` → PASS. Then `bun run check` → 0 errors.

- [ ] **Step 5: Commit**
```bash
git add src/lib/flows/master-flows.ts src/lib/flows/agent-flows.test.ts
git -c commit.gpgsign=false commit -m "feat(flows): representative Reminders agent flow (read-only, AGENT_FLOWS)"
```

---

### Task 4: ArtifactGallery component

**Files:**
- Create: `src/lib/components/artifacts/ArtifactGallery.svelte`
- Modify: `messages/en.json`, `messages/es.json`

**Interfaces:** `<ArtifactGallery artifacts={ArtifactDescriptor[]} canAdd={boolean} onopen={(a: ArtifactDescriptor) => void} />`.

> No unit test (presentational). Validated via Svelte autofixer + `bun run check` + live.

- [ ] **Step 1: i18n** — `messages/en.json`: `"artifacts_label": "Artifacts",` `"artifact_add": "Add artifact",` `"artifact_add_soon": "Custom artifacts are coming soon (admin).",` `"artifact_kind_static": "Static",` ; `messages/es.json`: `"artifacts_label": "Artefactos",` `"artifact_add": "Agregar artefacto",` `"artifact_add_soon": "Los artefactos personalizados llegarán pronto (admin).",` `"artifact_kind_static": "Estático",`.

- [ ] **Step 2: Write the component** — `src/lib/components/artifacts/ArtifactGallery.svelte`:

```svelte
<script lang="ts">
  import { Plus } from 'lucide-svelte';
  import * as m from '$lib/paraglide/messages';
  import { Popover } from '$lib/components/ui';
  import { resolvePluginIcon } from '$lib/plugins/icon-map';
  import type { ArtifactDescriptor } from '$lib/agents/artifacts';

  let {
    artifacts,
    canAdd = false,
    onopen,
  }: {
    artifacts: ArtifactDescriptor[];
    canAdd?: boolean;
    onopen: (a: ArtifactDescriptor) => void;
  } = $props();
</script>

<div class="border-t border-white/10 pt-3">
  <p class="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-white/35">{m.artifacts_label()}</p>
  <div class="flex flex-wrap items-center gap-2">
    {#each artifacts as a (a.id)}
      {@const Icon = resolvePluginIcon(a.icon)}
      <Popover placement="top">
        {#snippet trigger()}
          <button
            type="button"
            onclick={() => onopen(a)}
            aria-label={a.title}
            class="grid size-11 place-items-center rounded-lg border border-white/10 bg-white/[0.03] text-white/70 transition-colors hover:border-white/25 hover:bg-white/10 hover:text-white"
          >
            {#if typeof Icon !== 'string'}<Icon size={18} />{/if}
          </button>
        {/snippet}
        {#snippet children()}
          <div class="max-w-56 p-1">
            <p class="text-xs font-semibold text-white">{a.title}</p>
            <p class="mt-0.5 text-[11px] leading-snug text-white/60">{a.description}</p>
            <p class="mt-1 text-[10px] uppercase tracking-wide text-white/35">{m.artifact_kind_static()}</p>
          </div>
        {/snippet}
      </Popover>
    {/each}

    {#if canAdd}
      <Popover placement="top">
        {#snippet trigger()}
          <button
            type="button"
            aria-label={m.artifact_add()}
            class="grid size-11 place-items-center rounded-lg border border-dashed border-white/20 text-white/40 transition-colors hover:border-white/40 hover:text-white/70"
          >
            <Plus size={18} />
          </button>
        {/snippet}
        {#snippet children()}
          <p class="max-w-56 p-1 text-[11px] leading-snug text-white/60">{m.artifact_add_soon()}</p>
        {/snippet}
      </Popover>
      <!-- TODO: wire "+" to the artifact-builder system agent (#5, admin-only) -->
    {/if}
  </div>
</div>
```

- [ ] **Step 3: Validate + check** — run the Svelte MCP autofixer on the component (apply correctness fixes; confirm `Popover`'s `trigger`/`children` snippet API matches — adjust snippet usage to the real `Popover` contract if the autofixer/check flags it). `bun run i18n:compile && bun run check` → 0 errors.

- [ ] **Step 4: Commit**
```bash
git add src/lib/components/artifacts/ArtifactGallery.svelte messages/en.json messages/es.json
git -c commit.gpgsign=false commit -m "feat(artifacts): ArtifactGallery (icon tiles + popover + admin add-stub)"
```

---

### Task 5: Wire gallery + flow + modal into the card

**Files:**
- Modify: `src/lib/components/agents/AutonomousAgentCard.svelte`
- Modify: `messages/en.json`, `messages/es.json`

**Interfaces — Consumes:** new card props `artifacts: ArtifactDescriptor[]`, `canAdd: boolean`. Renders `ArtifactGallery`, an artifact `Modal(ArtifactHost)`, and a "View flow" button when `agent.flowId` is set.

- [ ] **Step 1: i18n** — `messages/en.json`: `"autonomous_view_flow": "View flow",` ; `messages/es.json`: `"autonomous_view_flow": "Ver flujo",`.

- [ ] **Step 2: Edit the card** — `src/lib/components/agents/AutonomousAgentCard.svelte`:
  - Update script: add imports + props + modal state:
```svelte
  import { goto } from '$app/navigation';
  import { Zap, Settings2, Workflow } from 'lucide-svelte';
  import * as m from '$lib/paraglide/messages';
  import type { AutonomousAgentVM } from '$lib/agents/autonomous';
  import type { ArtifactDescriptor } from '$lib/agents/artifacts';
  import ArtifactGallery from '$lib/components/artifacts/ArtifactGallery.svelte';
  import ArtifactHost from '$lib/components/artifacts/ArtifactHost.svelte';
  import { Modal } from '$lib/components/ui';

  let {
    agent,
    artifacts = [],
    canAdd = false,
  }: { agent: AutonomousAgentVM; artifacts?: ArtifactDescriptor[]; canAdd?: boolean } = $props();

  let openArtifact = $state<ArtifactDescriptor | null>(null);
```
  (Keep the existing `statusLabel`/`statusTone`/`stats` deriveds.)
  - In the footer, add a "View flow" button BEFORE the Manage button (only when `agent.flowId`):
```svelte
  <footer class="mt-auto flex items-center justify-between gap-2 pt-1">
    <span class="text-[11px] text-white/40">
      {#if agent.status.detail}{agent.status.detail}{:else if stats}{m.autonomous_activity({ sent: stats.sent, failed: stats.failed })}{/if}
    </span>
    <div class="flex items-center gap-2">
      {#if agent.flowId}
        <button
          type="button"
          onclick={() => goto(`/flow-editor/master/${agent.flowId}`)}
          class="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1 text-xs font-medium text-white/80 transition-colors hover:bg-white/10"
        >
          <Workflow size={13} />
          {m.autonomous_view_flow()}
        </button>
      {/if}
      <button
        type="button"
        onclick={() => goto(`/agents/autonomous/${encodeURIComponent(agent.id)}`)}
        class="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1 text-xs font-medium text-white/80 transition-colors hover:bg-white/10"
      >
        <Settings2 size={13} />
        {m.autonomous_manage()}
      </button>
    </div>
  </footer>

  {#if artifacts.length}
    <ArtifactGallery {artifacts} {canAdd} onopen={(a) => (openArtifact = a)} />
  {/if}
</article>

{#if openArtifact}
  <Modal open title={openArtifact.title} onclose={() => (openArtifact = null)}>
    <div class="h-[28rem]">
      <ArtifactHost descriptor={openArtifact} />
    </div>
  </Modal>
{/if}
```
  (Place the `ArtifactGallery` inside the `</article>` as the last child; the `Modal` after the article. Keep the header/description/trigger blocks unchanged.)

- [ ] **Step 3: Validate + check** — Svelte autofixer on the card; confirm the `Modal` open/title/onclose API matches the real component (adjust if flagged). `bun run i18n:compile && bun run check` → 0 errors.

- [ ] **Step 4: Commit**
```bash
git add src/lib/components/agents/AutonomousAgentCard.svelte messages/en.json messages/es.json
git -c commit.gpgsign=false commit -m "feat(agents): card artifact gallery + modal + View flow"
```

---

### Task 6: Roster load — artifactsByAgent + isAdmin

**Files:**
- Modify: `src/routes/(app)/agents/autonomous/+page.server.ts`
- Modify: `src/routes/(app)/agents/autonomous/+page.svelte`

**Interfaces:** load adds `artifactsByAgent: Record<string, ArtifactDescriptor[]>` + `isAdmin: boolean`; page passes `artifacts`/`canAdd` to each card.

- [ ] **Step 1: Edit the load** — `src/routes/(app)/agents/autonomous/+page.server.ts`:
```ts
import type { PageServerLoad } from './$types';
import { requireCoreCtx } from '$server/auth/core-ctx';
import { loadSystemAgentVMs } from '$lib/server/system-agents/registry';
import { getArtifactsForAgent } from '$lib/server/artifacts/registry';
import type { ArtifactDescriptor } from '$lib/agents/artifacts';

export const load: PageServerLoad = async ({ locals, depends }) => {
  const ctx = await requireCoreCtx(locals);
  depends('agents:autonomous');
  const systemAgents = await loadSystemAgentVMs(ctx).catch(() => []);
  const artifactsByAgent: Record<string, ArtifactDescriptor[]> = {};
  for (const a of systemAgents) artifactsByAgent[a.id] = getArtifactsForAgent(a.id);
  const isAdmin = locals.user?.role === 'admin';
  return { systemAgents, artifactsByAgent, isAdmin };
};
```

- [ ] **Step 2: Edit the page** — `src/routes/(app)/agents/autonomous/+page.svelte`:
  - Update the `data` prop type + pass props to the card. Change the data type to:
```ts
  let { data }: { data: { systemAgents: AutonomousAgentVM[]; artifactsByAgent: Record<string, import('$lib/agents/artifacts').ArtifactDescriptor[]>; isAdmin: boolean } } = $props();
```
  - In the `{#each agents as agent (agent.id)}` block, render:
```svelte
        <AutonomousAgentCard
          {agent}
          artifacts={data.artifactsByAgent[agent.id] ?? []}
          canAdd={data.isAdmin}
        />
```
  (gateway-merged agents simply get `[]` artifacts — they have no registry entry.)

- [ ] **Step 3: Check** — `bun run check` → 0 errors.

- [ ] **Step 4: Commit**
```bash
git add "src/routes/(app)/agents/autonomous/+page.server.ts" "src/routes/(app)/agents/autonomous/+page.svelte"
git -c commit.gpgsign=false commit -m "feat(agents): roster supplies per-agent artifacts + admin flag to cards"
```

---

### Task 7: Detail page "View flow" link

**Files:**
- Modify: `src/routes/(app)/agents/autonomous/[id]/+page.svelte`

- [ ] **Step 1: Add the link** — in the detail page header actions (where the Manage/Open-settings link lives), add, guarded by `agent.flowId`:
```svelte
      {#if agent.flowId}
        <a
          href={`/flow-editor/master/${agent.flowId}`}
          class="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1 text-xs font-medium text-white/80 hover:bg-white/10"
        >
          <Workflow size={13} />
          {m.autonomous_view_flow()}
        </a>
      {/if}
```
  Add `Workflow` to the existing `lucide-svelte` import. (`m.autonomous_view_flow` already added in Task 5.)

- [ ] **Step 2: Validate + check** — Svelte autofixer on the page; `bun run check` → 0 errors.

- [ ] **Step 3: Commit**
```bash
git add "src/routes/(app)/agents/autonomous/[id]/+page.svelte"
git -c commit.gpgsign=false commit -m "feat(agents): detail page View flow link"
```

---

### Task 8: Full verification

- [ ] **Step 1: Type-check** — `bun run i18n:compile && bun run check` → 0 errors / 0 warnings. Fix any new error in the above files.
- [ ] **Step 2: Tests** — `bun run test` → green; `artifacts.test.ts` + `agent-flows.test.ts` pass; the `aci-backend.test.ts` git-env flake (2 failures) is pre-existing/unrelated — confirm no NEW failures.
- [ ] **Step 3: Live check (best-effort)** — if a DB-connected dev server is available, on `/agents/autonomous`: the Reminders card shows an **Artifacts** row with an Overview icon tile (popover on hover) + an admin "+" tile; clicking the tile opens the Overview artifact in a modal; "View flow" opens `/flow-editor/master/agent-reminders` (read-only). If no DB-connected dev server, note live check deferred.
- [ ] **Step 4: Commit any fixes** (only if Steps 1–2 required changes).

---

## Self-Review

**Spec coverage:** icon+description on descriptor (T1) ✓; gallery icon tiles + popover (T4) ✓; admin-only stubbed "+" (T4 `canAdd` + T6 `isAdmin`) ✓; tile→modal(ArtifactHost) (T5) ✓; per-agent representative flow via master viewer (T3) + flowId (T2) + "View flow" on card (T5) & detail (T7) ✓; AGENT_FLOWS excluded from MASTER_FLOWS listing (T3) ✓; roster supplies artifacts+isAdmin (T6) ✓; i18n en/es (T2,T4,T5) ✓; tests for pure additions (T1,T3) ✓. Brain galleries + "+" wiring + triage flow/artifact correctly OUT (spec out-of-scope).

**Placeholder scan:** none — complete code/commands. The two "confirm the real Popover/Modal snippet contract via autofixer" notes are deliberate validation steps (the prop shapes are read from source: Popover `{trigger,children,open?,placement?}`, Modal `{open?,title?,onclose?,…}`), not placeholders.

**Type consistency:** `ArtifactDescriptor` (icon/description) defined T1, consumed T4/T5/T6. `flowId` defined T2 on meta+VM, consumed T5/T7. `overviewDescriptorFor(agentId,title,description)` T1, called T2 (registry). `getArtifactsForAgent` T2, called T6. `AGENT_FLOWS`/`getMasterFlow` T3, used by the existing `/flow-editor/master/[id]` route (unchanged). Card props `artifacts`/`canAdd` produced T6, consumed T5. `onopen` callback shape consistent T4↔T5.
