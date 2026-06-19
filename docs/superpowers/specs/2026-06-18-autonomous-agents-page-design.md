# Autonomous Agents Page + System-Agent Registry

**Date:** 2026-06-18
**Status:** Approved design — ready for implementation plan
**Scope:** Focused first iteration. Establishes the system-agent registry and a
dedicated, flow/builder-style Autonomous agents page. The scheduler's Reminders
agent is the first system agent surfaced.

## Problem

The Reminders agent (Scheduling R2, see
`2026-06-18-scheduling-reminders-agent-design.md`) is **hub-orchestrated** — a
cron tick + per-org DB config, not a gateway agent. The existing autonomous
roster at `/agents?archetype=autonomous` is built purely from gateway config
(`agents.list[].archetype`), so the Reminders agent — conceptually the clearest
"autonomous agent" in the product — is invisible there.

More broadly, all three archetypes (`copilot`, `brain`, `autonomous`) currently
share one page: a chat roster sidebar (`AgentSidebar`) + chat detail
(`DetailPanel` → `AgentDetail`). That conflates fundamentally different kinds of
agents.

## Product model (authoritative)

- **Autonomous agents** are triggered, headless workers — LangChain/graph flows
  from the agent builder that run on a trigger (cron, event) and/or participate
  in a larger process. They have **no chat interface** and **no personality** —
  a single job to do. Managed (not chatted with) by admins or team members of
  the relevant org area, **only** via the autonomous agents page.
- **System agents** are module-native autonomous agents — self-contained,
  triggered, a necessary reasoning part of a bigger whole — contributed by an
  integration/module. They appear on the autonomous agents page alongside
  builder/gateway autonomous agents.
- Every agent has a profile picture (DiceBear), a name, a **job role**, and a
  description/summary.

## Out of scope (deferred to later iterations)

- In-page graph/flow editing for autonomous agents.
- Reworking the Copilot and Brain archetype interfaces (they keep the current
  chat roster).
- Tagging builder agents with an archetype, or converting existing agents.
- A management UI for Reminders beyond what already exists at
  `/scheduling/reminders` (the registry entry links to it).

## Architecture

### 1. System-agent registry (the seam)

New module `src/lib/server/system-agents/registry.ts`. A static array of
descriptors plus a per-org status resolver. This is the extension point: future
system agents (finance sync, CRM auto-tagger, …) register here without touching
the page or card.

```ts
export interface SystemAgentStats {
  sent: number;
  failed: number;
  skipped: number;
}

export interface SystemAgentStatus {
  enabled: boolean;
  // 'active' (enabled + configured), 'disabled', or 'attention' (enabled but
  // misconfigured, e.g. no send account). Drives the status pill.
  state: 'active' | 'disabled' | 'attention';
  stats?: SystemAgentStats;   // optional 30-day activity summary
  detail?: string;            // short human note, e.g. "No WhatsApp account set"
}

export interface SystemAgentDescriptor {
  id: string;          // "scheduling.reminders"
  moduleId: string;    // "scheduling" — gates visibility via isModuleEnabled
  name: string;        // "Reminders"
  role: string;        // "Appointment Reminders" (job role subtitle)
  description: string; // one-line summary
  avatarSeed: string;  // DiceBear seed (stable)
  trigger: string;     // "On booking · 24h before · 2h before"
  managePath: string;  // "/scheduling/reminders"
  resolveStatus(ctx: CoreCtx): Promise<SystemAgentStatus>;
}

export const SYSTEM_AGENTS: SystemAgentDescriptor[] = [ /* reminders */ ];
```

**First entry — Reminders:**

```ts
{
  id: 'scheduling.reminders',
  moduleId: 'scheduling',
  name: 'Reminders',
  role: 'Appointment Reminders',
  description:
    'Sends WhatsApp confirmation and pre-appointment reminders automatically.',
  avatarSeed: 'minion-reminders-agent',
  trigger: 'On booking · 24h before · 2h before',
  managePath: '/scheduling/reminders',
  async resolveStatus(ctx) {
    const config = await getReminderConfig(ctx).catch(() => null);
    const activity = await getReminderActivity(ctx).catch(() => null);
    const enabled = !!config?.enabled;
    const needsAccount = enabled && !config?.accountId;
    return {
      enabled,
      state: !enabled ? 'disabled' : needsAccount ? 'attention' : 'active',
      stats: activity?.counts,
      detail: needsAccount ? 'No WhatsApp account set' : undefined,
    };
  },
}
```

### 2. Resolved view model + pure helper

To keep the page thin and the logic testable, a pure function maps descriptors
+ per-org module states + resolved statuses into the view model, and merges in
gateway autonomous agents.

**Module boundary (important):** the registry and `resolveStatus` touch the DB
via `ctx`, so they stay server-only under `$lib/server`. But the view-model type
and the gateway-merge mapper are also imported **client-side** by `+page.svelte`
— SvelteKit forbids importing `$lib/server/*` from client code. So the shared,
DB-free pieces live in a non-server module `src/lib/agents/autonomous.ts`
(importable from both sides), and the server registry imports the VM type from
there.

```ts
// src/lib/agents/autonomous.ts (pure, client+server importable, unit-tested)
export interface AutonomousAgentVM {
  id: string;
  source: 'system' | 'gateway';
  name: string;
  role: string;
  description: string;
  avatarUrl: string;     // diceBearAvatarUrl(seed) for system; gateway avatar otherwise
  trigger: string | null;
  managePath: string | null;
  status: SystemAgentStatus;
}
```

`resolveSystemAgents(descriptors, moduleStates, statuses)` filters descriptors to
those whose `moduleId` is enabled and maps to `AutonomousAgentVM`. Gateway
autonomous agents are merged on the client (see Data flow) and adapted to the
same VM shape with `source: 'gateway'`, `managePath: null` (no manage target
yet), and a minimal status (`{ enabled: true, state: 'active' }`).

### 3. Route & navigation

- New route: `src/routes/(app)/agents/autonomous/+page.server.ts` +
  `+page.svelte`.
- `src/lib/components/layout/sections.ts`: `archetypeItem('autonomous', …)`
  repoints `href` from `/agents?archetype=autonomous` to `/agents/autonomous`,
  and its `matcher` matches the new path (path-based, not query-based).
- Copilots and Brains are untouched — they keep `/agents?archetype=copilot|brain`
  and the shared chat roster.

### 4. Data flow

`/agents/autonomous/+page.server.ts`:

```
getCoreCtx(locals)  → 401 if absent
moduleStates = listModuleStates(ctx)
for each SYSTEM_AGENTS where isModuleEnabled(moduleId):
    status = await descriptor.resolveStatus(ctx)   // .catch() → disabled+detail
return { systemAgents: resolveSystemAgents(...) }
```

Each `resolveStatus` is `.catch()`-guarded so one module's failure degrades that
card to a disabled/error state rather than 500-ing the page (mirrors the
scheduling dashboard's per-panel `.catch()` pattern).

Gateway autonomous agents are merged **client-side** in `+page.svelte` from the
already-loaded gateway config (`getField('agents.list')` filtered to
`archetype === 'autonomous'`), reusing the exact source `AgentSidebar` reads.
For FACES this is currently empty; the merge keeps the page future-proof.

### 5. UI — flow/builder-style grid

`/agents/autonomous/+page.svelte` renders a card grid styled after
`/flow-editor` (section heading + responsive card grid), **not** the
`Splitter` + chat roster. New component
`src/lib/components/agents/AutonomousAgentCard.svelte`:

- DiceBear avatar (`diceBearAvatarUrl(avatarSeed)`), name, **job-role** subtitle.
- Description line.
- **Trigger badge** (e.g. "On booking · 24h before · 2h before").
- **Status pill**: Active / Disabled / Attention, plus a compact activity line
  ("12 sent · 0 failed · 30d") when stats exist; `detail` text on attention.
- **Manage** button → `managePath` (Reminders → `/scheduling/reminders`).
  Hidden/disabled when `managePath` is null.
- No chat affordance anywhere.

Empty state when there are zero autonomous agents (heading + short explainer).

### 6. Testing

- `autonomous.ts` pure helper: unit tests for module-gating (disabled module hides
  its system agents), status mapping (disabled / attention / active), and
  gateway merge shape. (vitest)
- Reminders `resolveStatus` mapping: enabled+account → active; enabled+no account
  → attention; disabled → disabled. (vitest, with stubbed config/activity)
- Card and page are thin presentational glue — no dedicated test beyond `check`.

### 7. i18n

New en/es keys: page heading + explainer, "Manage", status labels
(Active/Disabled/Attention), activity line ("{n} sent · {n} failed · 30d"), and
the Reminders descriptor strings (name/role/description/trigger) so they
localize. Descriptor strings are resolved through paraglide messages at read
time (same approach the nav uses), not hard-coded English.

## Components & files

| File | Change |
|---|---|
| `src/lib/server/system-agents/registry.ts` | NEW — descriptors + Reminders entry (server-only; DB access) |
| `src/lib/agents/autonomous.ts` | NEW — pure VM type + mapper + gateway merge (client+server) |
| `src/lib/agents/autonomous.test.ts` | NEW — unit tests |
| `src/routes/(app)/agents/autonomous/+page.server.ts` | NEW — module-gated load |
| `src/routes/(app)/agents/autonomous/+page.svelte` | NEW — card grid + client merge |
| `src/lib/components/agents/AutonomousAgentCard.svelte` | NEW — card |
| `src/lib/components/layout/sections.ts` | EDIT — repoint autonomous nav item |
| `src/lib/components/layout/sections.test.ts` | EDIT — matcher expectation |
| `messages/en.json`, `messages/es.json` (or paraglide source) | EDIT — new keys |

## Success criteria

- `/agents/autonomous` renders a flow/builder-style card grid (no chat roster).
- The Reminders agent appears as a card with avatar, name, job role,
  description, trigger, live status (Enabled for FACES today), and a Manage
  button that opens `/scheduling/reminders`.
- Disabling the scheduling module removes the Reminders card.
- The autonomous nav item routes to `/agents/autonomous`; Copilots/Brains
  unchanged.
- `pnpm check` clean; new vitest specs pass.
