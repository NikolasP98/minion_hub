# Autonomous Agents Page + System-Agent Registry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface module-native "system agents" (starting with the scheduler's Reminders agent) on a dedicated, flow/builder-style `/agents/autonomous` page, backed by an extensible hub-side system-agent registry.

**Architecture:** A pure, client+server-importable module (`src/lib/agents/autonomous.ts`) defines the view-model and pure mappers. A server-only registry (`src/lib/server/system-agents/registry.ts`) lists descriptors (Reminders first) and resolves their per-org live status via existing services. A new route renders the result as a card grid; gateway agents whose archetype is `autonomous` are merged client-side. The autonomous nav item repoints from the shared `?archetype=` roster to the new route.

**Tech Stack:** SvelteKit 2, Svelte 5 (runes), TypeScript (strict), Tailwind 4, Drizzle/Supabase (via existing services), Paraglide i18n, Vitest, Bun.

## Global Constraints

- Svelte 5 runes only — `$props()`, `$derived`, `$state`, `onclick={}`. No legacy Svelte 4 patterns. (verbatim: "Svelte 5 only … runes, snippets … No legacy Svelte 4 patterns.")
- TypeScript strict; avoid `any`; never add `@ts-nocheck`.
- i18n: every user-facing string added to BOTH `messages/en.json` and `messages/es.json`. Build compiles via `paraglide-js compile && vite build`.
- Server-only code lives under `$lib/server` / `$server`; anything imported by `.svelte` client code must NOT import from there.
- Verification command: `bun run check` (svelte-check) must be clean; `bun run test` (vitest) green.
- Commits: `git -c commit.gpgsign=false commit …` (1Password signing is down). Exclude `package-lock.json` (Bun project). Branch: `dev`.
- Module gating semantics: absent `app_modules` row = ENABLED (`resolveEnabled`). A `(mid) => moduleStates[mid] ?? true` check mirrors this.

---

### Task 1: Pure autonomous view-model module

**Files:**
- Create: `src/lib/agents/autonomous.ts`
- Test: `src/lib/agents/autonomous.test.ts`

**Interfaces:**
- Consumes: `diceBearAvatarUrl` from `$lib/utils/avatar`.
- Produces:
  - `interface SystemAgentStats { sent: number; failed: number; skipped: number }`
  - `interface SystemAgentStatus { enabled: boolean; state: 'active'|'disabled'|'attention'; stats?: SystemAgentStats; detail?: string }`
  - `interface SystemAgentMeta { id: string; moduleId: string; name: string; role: string; description: string; avatarSeed: string; trigger: string; managePath: string }`
  - `interface AutonomousAgentVM { id: string; source: 'system'|'gateway'; name: string; role: string; description: string; avatarUrl: string; trigger: string|null; managePath: string|null; status: SystemAgentStatus }`
  - `function remindersStatus(input: { enabled: boolean; hasAccount: boolean; stats?: SystemAgentStats }): SystemAgentStatus`
  - `function systemMetaToVM(meta: SystemAgentMeta, status: SystemAgentStatus): AutonomousAgentVM`
  - `function buildSystemAgentVMs(metas: SystemAgentMeta[], moduleEnabled: (moduleId: string) => boolean, statuses: Record<string, SystemAgentStatus>): AutonomousAgentVM[]`
  - `function gatewayAgentToVM(agent: { id: string; name?: string; emoji?: string; status?: string }, archetype: string | undefined): AutonomousAgentVM | null`

- [ ] **Step 1: Write the failing test**

Create `src/lib/agents/autonomous.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  remindersStatus,
  systemMetaToVM,
  buildSystemAgentVMs,
  gatewayAgentToVM,
  type SystemAgentMeta,
  type SystemAgentStatus,
} from './autonomous';

const meta: SystemAgentMeta = {
  id: 'scheduling.reminders',
  moduleId: 'scheduling',
  name: 'Reminders',
  role: 'Appointment Reminders',
  description: 'Sends WhatsApp reminders automatically.',
  avatarSeed: 'minion-reminders-agent',
  trigger: 'On booking · 24h before · 2h before',
  managePath: '/scheduling/reminders',
};

describe('remindersStatus', () => {
  it('disabled when not enabled', () => {
    expect(remindersStatus({ enabled: false, hasAccount: false })).toMatchObject({
      enabled: false,
      state: 'disabled',
    });
  });
  it('attention when enabled but no account', () => {
    const s = remindersStatus({ enabled: true, hasAccount: false });
    expect(s.state).toBe('attention');
    expect(s.detail).toBeTruthy();
  });
  it('active when enabled with account, carries stats', () => {
    const s = remindersStatus({ enabled: true, hasAccount: true, stats: { sent: 5, failed: 1, skipped: 0 } });
    expect(s.state).toBe('active');
    expect(s.stats?.sent).toBe(5);
  });
});

describe('systemMetaToVM', () => {
  it('maps meta + status into a system VM with a dicebear avatar', () => {
    const status: SystemAgentStatus = { enabled: true, state: 'active' };
    const vm = systemMetaToVM(meta, status);
    expect(vm).toMatchObject({
      id: 'scheduling.reminders',
      source: 'system',
      name: 'Reminders',
      role: 'Appointment Reminders',
      managePath: '/scheduling/reminders',
      trigger: 'On booking · 24h before · 2h before',
    });
    expect(vm.avatarUrl).toContain('api.dicebear.com');
    expect(vm.avatarUrl).toContain('minion-reminders-agent');
    expect(vm.status).toBe(status);
  });
});

describe('buildSystemAgentVMs', () => {
  it('includes agents whose module is enabled', () => {
    const vms = buildSystemAgentVMs([meta], () => true, {
      'scheduling.reminders': { enabled: true, state: 'active' },
    });
    expect(vms).toHaveLength(1);
    expect(vms[0].id).toBe('scheduling.reminders');
  });
  it('hides agents whose module is disabled', () => {
    const vms = buildSystemAgentVMs([meta], (mid) => mid !== 'scheduling', {});
    expect(vms).toHaveLength(0);
  });
  it('defaults to a disabled status when none resolved', () => {
    const vms = buildSystemAgentVMs([meta], () => true, {});
    expect(vms[0].status).toMatchObject({ enabled: false, state: 'disabled' });
  });
});

describe('gatewayAgentToVM', () => {
  it('returns null for non-autonomous archetypes', () => {
    expect(gatewayAgentToVM({ id: 'a1', name: 'Helper' }, 'copilot')).toBeNull();
    expect(gatewayAgentToVM({ id: 'a1', name: 'Helper' }, undefined)).toBeNull();
  });
  it('maps an autonomous gateway agent into a VM with no manage target', () => {
    const vm = gatewayAgentToVM({ id: 'a1', name: 'Nightly Job', status: 'idle' }, 'autonomous');
    expect(vm).toMatchObject({ id: 'a1', source: 'gateway', name: 'Nightly Job', managePath: null });
    expect(vm?.avatarUrl).toContain('api.dicebear.com');
    expect(vm?.status.state).toBe('active');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test -- src/lib/agents/autonomous.test.ts`
Expected: FAIL — module `./autonomous` not found / exports undefined.

- [ ] **Step 3: Write minimal implementation**

Create `src/lib/agents/autonomous.ts`:

```ts
import { diceBearAvatarUrl } from '$lib/utils/avatar';

export interface SystemAgentStats {
  sent: number;
  failed: number;
  skipped: number;
}

export interface SystemAgentStatus {
  enabled: boolean;
  state: 'active' | 'disabled' | 'attention';
  stats?: SystemAgentStats;
  detail?: string;
}

/** DB-free description of a system agent — safe to import on the client. */
export interface SystemAgentMeta {
  id: string;
  moduleId: string;
  name: string;
  role: string;
  description: string;
  avatarSeed: string;
  trigger: string;
  managePath: string;
}

export interface AutonomousAgentVM {
  id: string;
  source: 'system' | 'gateway';
  name: string;
  role: string;
  description: string;
  avatarUrl: string;
  trigger: string | null;
  managePath: string | null;
  status: SystemAgentStatus;
}

/**
 * Pure status mapping for the Reminders system agent. Kept here (not in the
 * server registry) so it can be unit-tested without importing DB clients.
 * `detail` is an i18n KEY-FREE marker the registry overrides with a localized
 * string; tests only assert it is truthy.
 */
export function remindersStatus(input: {
  enabled: boolean;
  hasAccount: boolean;
  stats?: SystemAgentStats;
}): SystemAgentStatus {
  if (!input.enabled) return { enabled: false, state: 'disabled', stats: input.stats };
  if (!input.hasAccount) {
    return { enabled: true, state: 'attention', stats: input.stats, detail: 'no-account' };
  }
  return { enabled: true, state: 'active', stats: input.stats };
}

export function systemMetaToVM(meta: SystemAgentMeta, status: SystemAgentStatus): AutonomousAgentVM {
  return {
    id: meta.id,
    source: 'system',
    name: meta.name,
    role: meta.role,
    description: meta.description,
    avatarUrl: diceBearAvatarUrl(meta.avatarSeed),
    trigger: meta.trigger,
    managePath: meta.managePath,
    status,
  };
}

export function buildSystemAgentVMs(
  metas: SystemAgentMeta[],
  moduleEnabled: (moduleId: string) => boolean,
  statuses: Record<string, SystemAgentStatus>,
): AutonomousAgentVM[] {
  return metas
    .filter((meta) => moduleEnabled(meta.moduleId))
    .map((meta) => systemMetaToVM(meta, statuses[meta.id] ?? { enabled: false, state: 'disabled' }));
}

export function gatewayAgentToVM(
  agent: { id: string; name?: string; emoji?: string; status?: string },
  archetype: string | undefined,
): AutonomousAgentVM | null {
  if (archetype !== 'autonomous') return null;
  const name = agent.name?.trim() || agent.id;
  return {
    id: agent.id,
    source: 'gateway',
    name,
    role: '',
    description: '',
    avatarUrl: diceBearAvatarUrl(name),
    trigger: null,
    managePath: null,
    status: { enabled: true, state: 'active' },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test -- src/lib/agents/autonomous.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add src/lib/agents/autonomous.ts src/lib/agents/autonomous.test.ts
git -c commit.gpgsign=false commit -m "feat(agents): pure autonomous-agent view-model module + tests"
```

---

### Task 2: Server-side system-agent registry

**Files:**
- Create: `src/lib/server/system-agents/registry.ts`
- Modify: `messages/en.json`, `messages/es.json` (add Reminders descriptor keys)

**Interfaces:**
- Consumes: `CoreCtx` from `$server/auth/core-ctx`; `listModuleStates` from `$server/services/modules.service`; `getReminderConfig` from `$server/services/reminder-config.service`; `getReminderActivity` from `$server/services/reminders.service`; `SystemAgentMeta`, `SystemAgentStatus`, `AutonomousAgentVM`, `buildSystemAgentVMs`, `remindersStatus` from `$lib/agents/autonomous`; paraglide `m`.
- Produces: `async function loadSystemAgentVMs(ctx: CoreCtx): Promise<AutonomousAgentVM[]>`.

> No unit test: this is DB-orchestration glue. The pure status/mapping logic it relies on is covered by Task 1; correctness here is verified by `bun run check` and the live page. The Reminders `detail` marker `'no-account'` from `remindersStatus` is replaced with a localized string before returning.

- [ ] **Step 1: Add i18n keys**

In `messages/en.json` add (anywhere among the keys; JSON object is flat):

```json
"sysagent_reminders_name": "Reminders",
"sysagent_reminders_role": "Appointment Reminders",
"sysagent_reminders_desc": "Sends WhatsApp confirmation and pre-appointment reminders automatically.",
"sysagent_reminders_trigger": "On booking · 24h before · 2h before",
"sysagent_status_no_account": "No WhatsApp account set",
```

In `messages/es.json` add the same keys with Spanish values:

```json
"sysagent_reminders_name": "Recordatorios",
"sysagent_reminders_role": "Recordatorios de citas",
"sysagent_reminders_desc": "Envía confirmaciones y recordatorios de cita por WhatsApp automáticamente.",
"sysagent_reminders_trigger": "Al reservar · 24h antes · 2h antes",
"sysagent_status_no_account": "Sin cuenta de WhatsApp configurada",
```

- [ ] **Step 2: Write the registry**

Create `src/lib/server/system-agents/registry.ts`:

```ts
import type { CoreCtx } from '$server/auth/core-ctx';
import { listModuleStates } from '$server/services/modules.service';
import { getReminderConfig } from '$server/services/reminder-config.service';
import { getReminderActivity } from '$server/services/reminders.service';
import {
  buildSystemAgentVMs,
  remindersStatus,
  type AutonomousAgentVM,
  type SystemAgentMeta,
  type SystemAgentStatus,
} from '$lib/agents/autonomous';
import * as m from '$lib/paraglide/messages';

interface SystemAgentDescriptor extends SystemAgentMeta {
  resolveStatus(ctx: CoreCtx): Promise<SystemAgentStatus>;
}

/**
 * Per-request descriptor list. A function (not a const) so paraglide messages
 * resolve in the request's language, mirroring getSections().
 */
function getSystemAgentDescriptors(): SystemAgentDescriptor[] {
  return [
    {
      id: 'scheduling.reminders',
      moduleId: 'scheduling',
      name: m.sysagent_reminders_name(),
      role: m.sysagent_reminders_role(),
      description: m.sysagent_reminders_desc(),
      avatarSeed: 'minion-reminders-agent',
      trigger: m.sysagent_reminders_trigger(),
      managePath: '/scheduling/reminders',
      async resolveStatus(ctx) {
        const [config, activity] = await Promise.all([
          getReminderConfig(ctx).catch(() => null),
          getReminderActivity(ctx).catch(() => null),
        ]);
        const status = remindersStatus({
          enabled: !!config?.enabled,
          hasAccount: !!config?.accountId,
          stats: activity?.counts,
        });
        // Localize the attention detail marker emitted by the pure helper.
        if (status.detail === 'no-account') status.detail = m.sysagent_status_no_account();
        return status;
      },
    },
  ];
}

/** Resolve all visible system agents for an org into view-models. */
export async function loadSystemAgentVMs(ctx: CoreCtx): Promise<AutonomousAgentVM[]> {
  const descriptors = getSystemAgentDescriptors();
  const moduleStates = await listModuleStates(ctx).catch(() => ({}) as Record<string, boolean>);
  const statuses: Record<string, SystemAgentStatus> = {};
  await Promise.all(
    descriptors.map(async (d) => {
      statuses[d.id] = await d
        .resolveStatus(ctx)
        .catch(() => ({ enabled: false, state: 'disabled' as const }));
    }),
  );
  const metas: SystemAgentMeta[] = descriptors.map(({ resolveStatus: _omit, ...meta }) => meta);
  return buildSystemAgentVMs(metas, (mid) => moduleStates[mid] ?? true, statuses);
}
```

- [ ] **Step 3: Verify it type-checks**

Run: `bun run check`
Expected: no new errors referencing `registry.ts` or the message keys.

- [ ] **Step 4: Commit**

```bash
git add src/lib/server/system-agents/registry.ts messages/en.json messages/es.json
git -c commit.gpgsign=false commit -m "feat(agents): system-agent registry with Reminders descriptor"
```

---

### Task 3: Autonomous page server load

**Files:**
- Create: `src/routes/(app)/agents/autonomous/+page.server.ts`

**Interfaces:**
- Consumes: `requireCoreCtx` from `$server/auth/core-ctx`; `loadSystemAgentVMs` from `$lib/server/system-agents/registry`.
- Produces: page `data.systemAgents: AutonomousAgentVM[]`.

> No unit test: SvelteKit load glue, verified by `bun run check` + live page.

- [ ] **Step 1: Write the load function**

Create `src/routes/(app)/agents/autonomous/+page.server.ts`:

```ts
import type { PageServerLoad } from './$types';
import { requireCoreCtx } from '$server/auth/core-ctx';
import { loadSystemAgentVMs } from '$lib/server/system-agents/registry';

export const load: PageServerLoad = async ({ locals, depends }) => {
  const ctx = await requireCoreCtx(locals); // throws 401 if unauthenticated
  depends('agents:autonomous');
  const systemAgents = await loadSystemAgentVMs(ctx).catch(() => []);
  return { systemAgents };
};
```

- [ ] **Step 2: Verify it type-checks**

Run: `bun run check`
Expected: clean (note: `./$types` is generated by svelte-kit sync, which `check` runs first).

- [ ] **Step 3: Commit**

```bash
git add "src/routes/(app)/agents/autonomous/+page.server.ts"
git -c commit.gpgsign=false commit -m "feat(agents): /agents/autonomous server load (system agents)"
```

---

### Task 4: AutonomousAgentCard component

**Files:**
- Create: `src/lib/components/agents/AutonomousAgentCard.svelte`
- Modify: `messages/en.json`, `messages/es.json` (card/status strings)

**Interfaces:**
- Consumes: `AutonomousAgentVM` from `$lib/agents/autonomous`; `goto` from `$app/navigation`; paraglide `m`; lucide icons.
- Produces: `<AutonomousAgentCard agent={vm} />` (prop `agent: AutonomousAgentVM`).

> No unit test: presentational. Verified via `bun run check` and visual check in Task 7.

- [ ] **Step 1: Add i18n keys**

In `messages/en.json`:

```json
"autonomous_manage": "Manage",
"autonomous_status_active": "Active",
"autonomous_status_disabled": "Disabled",
"autonomous_status_attention": "Needs attention",
```

In `messages/es.json`:

```json
"autonomous_manage": "Gestionar",
"autonomous_status_active": "Activo",
"autonomous_status_disabled": "Inactivo",
"autonomous_status_attention": "Requiere atención",
```

- [ ] **Step 2: Write the component**

Create `src/lib/components/agents/AutonomousAgentCard.svelte`:

```svelte
<script lang="ts">
  import { goto } from '$app/navigation';
  import { Zap, Settings2 } from 'lucide-svelte';
  import * as m from '$lib/paraglide/messages';
  import type { AutonomousAgentVM } from '$lib/agents/autonomous';

  let { agent }: { agent: AutonomousAgentVM } = $props();

  const statusLabel = $derived(
    agent.status.state === 'active'
      ? m.autonomous_status_active()
      : agent.status.state === 'attention'
        ? m.autonomous_status_attention()
        : m.autonomous_status_disabled(),
  );

  // Tailwind tone per state.
  const statusTone = $derived(
    agent.status.state === 'active'
      ? 'bg-emerald-500/15 text-emerald-300 ring-emerald-500/30'
      : agent.status.state === 'attention'
        ? 'bg-amber-500/15 text-amber-300 ring-amber-500/30'
        : 'bg-white/5 text-white/50 ring-white/10',
  );

  const stats = $derived(agent.status.stats);
</script>

<article
  class="flex flex-col gap-3 rounded-xl border border-white/10 bg-white/[0.02] p-4 transition-colors hover:border-white/20"
>
  <header class="flex items-start gap-3">
    <img
      src={agent.avatarUrl}
      alt=""
      class="size-11 shrink-0 rounded-lg bg-white/5 ring-1 ring-white/10"
      loading="lazy"
    />
    <div class="min-w-0 flex-1">
      <h3 class="truncate text-sm font-semibold text-white">{agent.name}</h3>
      {#if agent.role}
        <p class="truncate text-xs text-white/50">{agent.role}</p>
      {/if}
    </div>
    <span
      class="shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 {statusTone}"
    >
      {statusLabel}
    </span>
  </header>

  {#if agent.description}
    <p class="line-clamp-2 text-xs leading-relaxed text-white/60">{agent.description}</p>
  {/if}

  {#if agent.trigger}
    <div class="flex items-center gap-1.5 text-[11px] text-white/45">
      <Zap size={12} />
      <span class="truncate">{agent.trigger}</span>
    </div>
  {/if}

  <footer class="mt-auto flex items-center justify-between gap-2 pt-1">
    <span class="text-[11px] text-white/40">
      {#if agent.status.detail}
        {agent.status.detail}
      {:else if stats}
        {stats.sent} sent · {stats.failed} failed · 30d
      {/if}
    </span>
    {#if agent.managePath}
      <button
        type="button"
        onclick={() => goto(agent.managePath!)}
        class="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1 text-xs font-medium text-white/80 transition-colors hover:bg-white/10"
      >
        <Settings2 size={13} />
        {m.autonomous_manage()}
      </button>
    {/if}
  </footer>
</article>
```

- [ ] **Step 3: Verify it type-checks**

Run: `bun run check`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/lib/components/agents/AutonomousAgentCard.svelte messages/en.json messages/es.json
git -c commit.gpgsign=false commit -m "feat(agents): AutonomousAgentCard component"
```

---

### Task 5: Autonomous page (grid + client merge)

**Files:**
- Create: `src/routes/(app)/agents/autonomous/+page.svelte`
- Modify: `messages/en.json`, `messages/es.json` (page heading/explainer/empty)

**Interfaces:**
- Consumes: `data.systemAgents` (from Task 3); `visibleAgents` from `$lib/state/gateway/gateway-data.svelte`; `getField` + `configState` + `loadConfig` from `$lib/state/config/config.svelte`; `conn` from `$lib/state/gateway/connection.svelte`; `gatewayAgentToVM` + `AutonomousAgentVM` from `$lib/agents/autonomous`; `AutonomousAgentCard`; paraglide `m`.
- Produces: the rendered page (no exports).

> No unit test: page glue. The merge mapper (`gatewayAgentToVM`) is unit-tested in Task 1. Verified live in Task 7.

- [ ] **Step 1: Add i18n keys**

In `messages/en.json`:

```json
"autonomous_page_title": "Autonomous agents",
"autonomous_page_subtitle": "Triggered, self-running automations — no chat, just a job.",
"autonomous_empty": "No autonomous agents yet. Enable a module (like Scheduling) to add one.",
```

In `messages/es.json`:

```json
"autonomous_page_title": "Agentes autónomos",
"autonomous_page_subtitle": "Automatizaciones activadas que se ejecutan solas — sin chat, solo una tarea.",
"autonomous_empty": "Aún no hay agentes autónomos. Activa un módulo (como Agenda) para agregar uno.",
```

- [ ] **Step 2: Write the page**

Create `src/routes/(app)/agents/autonomous/+page.svelte`:

```svelte
<script lang="ts">
  import { onMount } from 'svelte';
  import * as m from '$lib/paraglide/messages';
  import AutonomousAgentCard from '$lib/components/agents/AutonomousAgentCard.svelte';
  import { gatewayAgentToVM, type AutonomousAgentVM } from '$lib/agents/autonomous';
  import { visibleAgents } from '$lib/state/gateway/gateway-data.svelte';
  import { conn } from '$lib/state/gateway/connection.svelte';
  import { configState, loadConfig, getField } from '$lib/state/config/config.svelte';

  let { data }: { data: { systemAgents: AutonomousAgentVM[] } } = $props();

  onMount(() => {
    // Archetype lives in gateway config (agents.list[].archetype); ensure loaded.
    if (conn.connected && !configState.loaded && !configState.loading) loadConfig();
  });

  // id → archetype map from gateway config, same source AgentSidebar reads.
  const archetypeById = $derived.by(() => {
    const list = getField('agents.list');
    const map: Record<string, string> = {};
    if (Array.isArray(list)) {
      for (const a of list as Array<{ id?: string; archetype?: string }>) {
        if (a && typeof a.id === 'string' && typeof a.archetype === 'string') map[a.id] = a.archetype;
      }
    }
    return map;
  });

  const gatewayVMs = $derived(
    visibleAgents.value
      .map((a) => gatewayAgentToVM(a as { id: string; name?: string; status?: string }, archetypeById[(a as { id: string }).id]))
      .filter((vm): vm is AutonomousAgentVM => vm !== null),
  );

  const agents = $derived<AutonomousAgentVM[]>([...data.systemAgents, ...gatewayVMs]);
</script>

<div class="flex h-full flex-col overflow-y-auto p-6">
  <header class="mb-5">
    <h1 class="text-lg font-semibold text-white">{m.autonomous_page_title()}</h1>
    <p class="mt-1 text-sm text-white/50">{m.autonomous_page_subtitle()}</p>
  </header>

  {#if agents.length === 0}
    <div class="rounded-xl border border-dashed border-white/10 bg-white/[0.02] p-8 text-center text-sm text-white/45">
      {m.autonomous_empty()}
    </div>
  {:else}
    <div class="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {#each agents as agent (agent.id)}
        <AutonomousAgentCard {agent} />
      {/each}
    </div>
  {/if}
</div>
```

- [ ] **Step 3: Verify it type-checks**

Run: `bun run check`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add "src/routes/(app)/agents/autonomous/+page.svelte" messages/en.json messages/es.json
git -c commit.gpgsign=false commit -m "feat(agents): autonomous agents page grid + gateway merge"
```

---

### Task 6: Repoint the autonomous nav item

**Files:**
- Modify: `src/lib/components/layout/sections.ts` (the `autonomous` archetype item)
- Modify: `src/lib/components/layout/sections.test.ts` (expectation)

**Interfaces:**
- Consumes: nothing new.
- Produces: nav item with `href: '/agents/autonomous'` and a path-based matcher.

- [ ] **Step 1: Update the test to the new expectation (TDD)**

In `src/lib/components/layout/sections.test.ts`, replace the third `it(...)` block with:

```ts
  it('keeps Copilots/AI Brains as ?archetype= filters and routes Autonomous to its own page', () => {
    const agents = getSections().find((s) => s.id === 'agents');
    const archetypeHrefs = agents?.items
      .map((i) => i.href)
      .filter((h) => h.startsWith('/agents?archetype='));
    expect(archetypeHrefs).toEqual([
      '/agents?archetype=copilot',
      '/agents?archetype=brain',
    ]);
    const autonomous = agents?.items.find((i) => i.href === '/agents/autonomous');
    expect(autonomous).toBeTruthy();
    expect(autonomous?.matcher('/agents/autonomous')).toBe(true);
    expect(autonomous?.matcher('/agents')).toBe(false);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test -- src/lib/components/layout/sections.test.ts`
Expected: FAIL — autonomous still emitted as `/agents?archetype=autonomous`; no item with href `/agents/autonomous`.

- [ ] **Step 3: Update sections.ts**

In `src/lib/components/layout/sections.ts`, within `getSections()`'s `agentItems`, replace the line:

```ts
        archetypeItem("autonomous", m.nav_autonomous(), Zap),
```

with a dedicated path-based item:

```ts
        {
            href: "/agents/autonomous",
            label: m.nav_autonomous(),
            icon: Zap,
            matcher: (p) => p === "/agents/autonomous" || p.startsWith("/agents/autonomous/"),
        },
```

(Leave `archetypeItem` and the `copilot`/`brain` entries unchanged.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun run test -- src/lib/components/layout/sections.test.ts`
Expected: PASS (all three `it` blocks).

- [ ] **Step 5: Commit**

```bash
git add src/lib/components/layout/sections.ts src/lib/components/layout/sections.test.ts
git -c commit.gpgsign=false commit -m "feat(nav): route Autonomous archetype to /agents/autonomous"
```

---

### Task 7: Full verification

**Files:** none (verification only).

- [ ] **Step 1: Full type-check**

Run: `bun run check`
Expected: `0 errors` (warnings unchanged from baseline). Fix any new error referencing the files above.

- [ ] **Step 2: Full test suite**

Run: `bun run test`
Expected: green; the new `autonomous.test.ts` and updated `sections.test.ts` pass; total count unchanged elsewhere.

- [ ] **Step 3: Live check (dev server)**

Run the dev server, sign in as a FACES admin, navigate to **Agents → Autonomous** (`/agents/autonomous`). Confirm:
  - A **Reminders** card shows: dicebear avatar, name "Reminders", role "Appointment Reminders", description, trigger badge, and an **Active** status pill (FACES has reminders enabled with account `+51906090526`).
  - The **Manage** button navigates to `/scheduling/reminders`.
  - The nav item "Autonomous" lights up on this route; Copilots/Brains still open the chat roster.

  Optionally verify module-gating: temporarily disabling the Scheduling module in Settings → Modules removes the Reminders card (then re-enable).

- [ ] **Step 4: Final confirmation**

No commit needed if Steps 1–2 were already committed per task. If `check` required fixes, commit them:

```bash
git add -A
git -c commit.gpgsign=false commit -m "chore(agents): autonomous page verification fixes"
```

---

## Self-Review

**Spec coverage:**
- System-agent registry → Task 2 ✓
- Pure VM + module boundary (client-importable) → Task 1 ✓
- Reminders as first system agent (status from config+activity) → Task 1 (`remindersStatus`) + Task 2 (`resolveStatus`) ✓
- Dedicated `/agents/autonomous` route, flow/builder-style grid → Tasks 3, 5 ✓
- Card: avatar, name, job role, description, trigger, status pill, Manage → Task 4 ✓
- Module-gating (disabled module hides card) → Task 1 (`buildSystemAgentVMs`) + Task 2 ✓
- Gateway autonomous agents merged client-side → Task 1 (`gatewayAgentToVM`) + Task 5 ✓
- Nav repoint + Copilots/Brains unchanged → Task 6 ✓
- i18n en/es → Tasks 2, 4, 5 ✓
- Status pill states Active/Disabled/Attention → Task 1 + Task 4 ✓
- Tests for pure logic → Task 1, Task 6 ✓

**Placeholder scan:** No TBD/TODO; all steps contain concrete code or exact commands. The `'no-account'` marker is intentional and explained (localized in Task 2). ✓

**Type consistency:** `AutonomousAgentVM`, `SystemAgentMeta`, `SystemAgentStatus`, `SystemAgentStats` defined in Task 1 and consumed unchanged in Tasks 2/3/4/5. `loadSystemAgentVMs(ctx)` defined Task 2, consumed Task 3. `gatewayAgentToVM(agent, archetype)` defined Task 1, consumed Task 5. `data.systemAgents` produced Task 3, consumed Task 5. ✓
