# Alert-Watcher → Triage Autonomous Agent — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Re-frame the gateway `alert-watcher` plugin as a hub **Triage** autonomous agent — a Triage system-agent descriptor, a gateway-fed triage KPI artifact, a representative flow, and removal of its hub plugin surfaces. The gateway kernel stays the runtime (A1).

**Architecture:** Triage is a system agent (registry descriptor) whose status + artifact data come from the gateway's `plugins.alerts.summary`/`recent` RPCs, fetched **per-user** (org-scoped via the connection identity) and handed to a hub-served artifact through the existing gated bridge. Its hub *plugin* surfaces (Settings→Plugins, nav) are filtered out; the gateway plugin is untouched.

**Tech Stack:** SvelteKit 2, Svelte 5 (runes), TypeScript, Paraglide i18n, Vitest, Bun. Hub repo, branch `dev`.

## Global Constraints

- Svelte 5 runes only; TS strict, no `any`; no `@ts-nocheck`.
- i18n in BOTH `messages/en.json` + `messages/es.json`; `bun run i18n:compile` before `bun run check`.
- `bun run check` 0/0; `bun run test` green. Commits UNSIGNED (`git -c commit.gpgsign=false`); never `git add` a lockfile or `sdd/`.
- Validate every `.svelte`/`.html` artifact with the Svelte MCP autofixer where applicable.
- **Tenancy (critical):** `plugins.alerts.*` scope by the gateway connection's `client.orgId`, NOT a param. Use `gatewayCallAsUser(method, params, profileId)` (per-user creds → correct org) — NOT `gatewayCall` (system creds → all orgs). `profileId` = the user's `supabaseId`.
- Read-only against the gateway; all gateway calls `.catch`-guarded (degrade, never 500).

## Reference: verified shapes

- `gatewayCallAsUser<T>(method, params, profileId)` — `$lib/server/gateway-rpc` (resolves per-user gateway creds; falls back to system creds if profileId is undefined — so MUST pass it).
- `plugins.alerts.summary` params `{ since?: number (epoch ms, default now-7d), until?: number }` → `{ counts: { low, med, high, total, notified, responded }, byDay, byCategory, topSenders }` (org-scoped via connection).
- `plugins.alerts.recent` params `{ limit?: number, chatId? }` → `{ rows: ComplaintRow[] }`; `ComplaintRow` has `severity` ('low'|'med'|'high'), `category`, `summary`, `created_at` (number), `from_sender`, …
- `CoreCtx = { db, tenantId }` (`$server/auth/core-ctx`); `getCoreCtx`/`requireCoreCtx` build it from `locals`, and already read `locals.user?.supabaseId` internally.
- `ArtifactDescriptor = { id, agentId, slot, title, description, icon, kind, entrypoint }`; `ArtifactContext = { agentId, agentName, agentRole, agentDescription, status, trigger }`. `overviewDescriptorFor(agentId, title, description)`. `getArtifactsForAgent(agentId)` / `getArtifactContext(ctx, agentId, artifactId)` in `src/lib/server/artifacts/registry.ts`.
- System-agent registry: `getSystemAgentDescriptors()` returns descriptors `{ id, moduleId, name, role, description, avatarSeed, trigger, managePath, flowId?, resolveStatus(ctx) }`; `loadSystemAgentVMs(ctx)`.
- `AGENT_FLOWS` + `getMasterFlow` in `src/lib/flows/master-flows.ts`; `MasterFlow`/`MasterFlowNode{kind,title,subtitle?,position,branches?}`/`at(col,lane)`; kinds include `trigger|guard|process|llm|agent|router|channel|intercept|hook|end`.
- Artifact serving route `src/routes/artifacts/[artifactId]/ui/[...path]/+server.ts` has a `BUNDLES` map of `?raw`-imported HTML. Context API `src/routes/api/artifacts/[id]/context/+server.ts`.
- `pluginsUiList()` in `src/lib/server/gateway-rpc.ts`; `PLUGIN_CATEGORY_OVERRIDES` in `src/lib/components/layout/sections.ts`.

---

### Task 1: `CoreCtx.profileId` (per-user gateway scoping)

**Files:** Modify `src/server/auth/core-ctx.ts`.

**Interfaces — Produces:** `CoreCtx` gains `profileId?: string` (the user's `supabaseId`), populated by `getCoreCtx`/`requireCoreCtx`.

> No new test (additive optional field; covered by `bun run check` + downstream tasks). Existing CoreCtx consumers are unaffected (optional).

- [ ] **Step 1: Add the field + populate it** — in `src/server/auth/core-ctx.ts`:
  - add `profileId?: string;` to the `CoreCtx` interface (after `tenantId`).
  - where `getCoreCtx` returns `{ db: getCoreDb(), tenantId: base.tenantId }`, add `profileId: locals.user?.supabaseId`. (The file already references `locals.user?.supabaseId`.) `requireCoreCtx` delegates to `getCoreCtx`, so it inherits it.

- [ ] **Step 2: Verify** — `bun run check` → 0 errors.

- [ ] **Step 3: Commit**
```bash
git add src/server/auth/core-ctx.ts
git -c commit.gpgsign=false commit -m "feat(auth): expose user profileId on CoreCtx for per-user gateway calls"
```

---

### Task 2: Pure artifact additions (triage descriptor, data type, mappers)

**Files:** Modify `src/lib/agents/artifacts.ts`, `src/lib/agents/artifacts.test.ts`.

**Interfaces — Produces:**
- `ArtifactContext.data?: TriageArtifactData` (optional per-artifact payload).
- `interface TriageArtifactData { counts: { total: number; high: number; med: number; low: number; notified: number; responded: number }; recent: Array<{ severity: 'low'|'med'|'high'; category: string; summary: string; createdAt: number }> }`.
- `triageDescriptorFor(agentId: string, title: string, description: string): ArtifactDescriptor` (id `'triage'`, icon `'Megaphone'`).
- `triageStatusDetail(counts: TriageArtifactData['counts'] | null): string` (pure card-detail string).
- `mapRecentRows(rows: Array<Record<string, unknown>>): TriageArtifactData['recent']` (pure ComplaintRow→recent mapper).

- [ ] **Step 1: Write failing tests** — append to `src/lib/agents/artifacts.test.ts`:

```ts
import { triageDescriptorFor, triageStatusDetail, mapRecentRows } from './artifacts';

describe('triageDescriptorFor', () => {
  it('builds the triage descriptor with Megaphone icon', () => {
    expect(triageDescriptorFor('alert-watcher', 'Triage', 'desc')).toEqual({
      id: 'triage', agentId: 'alert-watcher', slot: 'detail', title: 'Triage',
      description: 'desc', icon: 'Megaphone', kind: 'static', entrypoint: 'index.html',
    });
  });
});
describe('triageStatusDetail', () => {
  it('summarizes counts', () => {
    expect(triageStatusDetail({ total: 12, high: 3, med: 0, low: 0, notified: 0, responded: 0 })).toMatch(/12/);
    expect(triageStatusDetail({ total: 0, high: 0, med: 0, low: 0, notified: 0, responded: 0 })).toMatch(/0|no/i);
    expect(triageStatusDetail(null)).toMatch(/unavailable|—/i);
  });
});
describe('mapRecentRows', () => {
  it('maps ComplaintRow shape to recent[]', () => {
    const out = mapRecentRows([{ severity: 'high', category: 'billing', summary: 's', created_at: 123 }]);
    expect(out).toEqual([{ severity: 'high', category: 'billing', summary: 's', createdAt: 123 }]);
  });
  it('ignores malformed rows', () => {
    expect(mapRecentRows([{}, { severity: 'low', category: 'x', summary: 'y', created_at: 1 }])).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run red** — `bun run test -- src/lib/agents/artifacts.test.ts` → FAIL (exports missing).

- [ ] **Step 3: Implement** — in `src/lib/agents/artifacts.ts`:
  - add `data?: TriageArtifactData;` to `ArtifactContext`.
  - add the `TriageArtifactData` interface.
  - add the three functions:

```ts
export interface TriageArtifactData {
  counts: { total: number; high: number; med: number; low: number; notified: number; responded: number };
  recent: Array<{ severity: 'low' | 'med' | 'high'; category: string; summary: string; createdAt: number }>;
}

/** The triage artifact, attached to the alert-watcher (Triage) agent. Strings localized by the caller. */
export function triageDescriptorFor(agentId: string, title: string, description: string): ArtifactDescriptor {
  return { id: 'triage', agentId, slot: 'detail', title, description, icon: 'Megaphone', kind: 'static', entrypoint: 'index.html' };
}

/** Card-pill detail string from alert counts (pure; null = gateway unavailable). */
export function triageStatusDetail(counts: TriageArtifactData['counts'] | null): string {
  if (!counts) return 'Status unavailable';
  if (counts.total === 0) return 'No alerts in 30d';
  return `${counts.total} alerts · ${counts.high} high (30d)`;
}

/** Map gateway ComplaintRow records to the artifact's recent[] (pure; drops malformed). */
export function mapRecentRows(rows: Array<Record<string, unknown>>): TriageArtifactData['recent'] {
  const out: TriageArtifactData['recent'] = [];
  for (const r of rows) {
    const severity = r.severity;
    if (severity !== 'low' && severity !== 'med' && severity !== 'high') continue;
    if (typeof r.category !== 'string' || typeof r.summary !== 'string' || typeof r.created_at !== 'number') continue;
    out.push({ severity, category: r.category, summary: r.summary, createdAt: r.created_at });
  }
  return out;
}
```

- [ ] **Step 4: Run green** — `bun run test -- src/lib/agents/artifacts.test.ts` → PASS. `bun run check` → 0.

- [ ] **Step 5: Commit**
```bash
git add src/lib/agents/artifacts.ts src/lib/agents/artifacts.test.ts
git -c commit.gpgsign=false commit -m "feat(artifacts): triage descriptor + TriageArtifactData + pure mappers"
```

---

### Task 3: Triage system-agent descriptor + representative flow

**Files:** Modify `src/lib/server/system-agents/registry.ts`, `src/lib/flows/master-flows.ts`, `messages/en.json`, `messages/es.json`.

**Interfaces:** adds a Triage descriptor (`id: 'alert-watcher'`, `flowId: 'agent-alert-watcher'`, gateway-fed `resolveStatus`) to `getSystemAgentDescriptors()`, and an `agent-alert-watcher` flow to `AGENT_FLOWS`.

> No new unit test for the descriptor (gateway-call glue; `triageStatusDetail` is tested in Task 2). `getMasterFlow('agent-alert-watcher')` resolution is covered by a one-line addition to the existing `agent-flows.test.ts`.

- [ ] **Step 1: i18n** — add to `messages/en.json`: `"sysagent_triage_name": "Alert Watcher",` `"sysagent_triage_role": "Message triage",` `"sysagent_triage_desc": "Classifies every inbound message and routes complaints to your team.",` `"sysagent_triage_trigger": "Every inbound message",` `"artifact_triage_title": "Triage dashboard",` `"artifact_triage_desc": "Alert counts and recent complaints from the triage kernel.",`. Spanish in `messages/es.json`: `"sysagent_triage_name": "Alert Watcher",` `"sysagent_triage_role": "Triaje de mensajes",` `"sysagent_triage_desc": "Clasifica cada mensaje entrante y enruta las quejas a tu equipo.",` `"sysagent_triage_trigger": "Cada mensaje entrante",` `"artifact_triage_title": "Panel de triaje",` `"artifact_triage_desc": "Conteo de alertas y quejas recientes del núcleo de triaje.",`.

- [ ] **Step 2: Add the Triage flow** — in `src/lib/flows/master-flows.ts`, add to the `AGENT_FLOWS` array (after `remindersAgentFlow`):

```ts
const alertWatcherAgentFlow: MasterFlow = {
  id: 'agent-alert-watcher',
  name: 'Alert Watcher (Triage)',
  description:
    'How the Alert Watcher triage agent works: it intercepts every inbound channel message, classifies it with one LLM call into is_complaint/severity/category, and for real complaints fans out an alert to the owner channels and opens a claimable handoff. Non-complaints take no edge and fall through to the normal agent loop. Runs in the gateway.',
  tags: ['autonomous', 'triage', 'gateway'],
  nodes: [
    { id: 'inbound', kind: 'trigger', title: 'Inbound message', subtitle: 'every channel message (message_inbound/received hook)', position: at(0) },
    { id: 'gate', kind: 'guard', title: 'Dedup + cooldown', subtitle: 'ring-LRU dedup · per-chat cooldown (escalation-aware)', position: at(1), branches: [{ id: 'pass', label: 'Pass' }, { id: 'drop', label: 'Suppressed' }] },
    { id: 'classify', kind: 'llm', title: 'Classify (LLM)', subtitle: 'haiku · {is_complaint, severity, category, summary}', position: at(2) },
    { id: 'route', kind: 'router', title: 'Severity router', subtitle: 'high / med / low / none', position: at(3), branches: [{ id: 'high', label: 'high' }, { id: 'med', label: 'med' }, { id: 'low', label: 'low' }, { id: 'none', label: 'none' }] },
    { id: 'alert', kind: 'channel', title: 'Fan out alert', subtitle: 'parallel send to owner destinations · delivery-tracked', position: at(4) },
    { id: 'handoff', kind: 'intercept', title: 'Claimable handoff', subtitle: 'first-reply-wins · owner reply → forwarded to customer', position: at(5) },
    { id: 'ignore', kind: 'end', title: 'Normal agent loop', subtitle: 'not a complaint → no edge → conversational agent replies', position: at(3, -2) },
    { id: 'done', kind: 'end', title: 'Logged', subtitle: 'alerts.db complaint row + pending_reply', position: at(6) },
  ],
  edges: [
    { id: 'e-in-gate', source: 'inbound', target: 'gate' },
    { id: 'e-gate-classify', source: 'gate', sourceHandle: 'pass', target: 'classify' },
    { id: 'e-classify-route', source: 'classify', target: 'route' },
    { id: 'e-route-high', source: 'route', sourceHandle: 'high', target: 'alert' },
    { id: 'e-route-med', source: 'route', sourceHandle: 'med', target: 'alert' },
    { id: 'e-route-low', source: 'route', sourceHandle: 'low', target: 'alert' },
    { id: 'e-route-none', source: 'route', sourceHandle: 'none', target: 'ignore' },
    { id: 'e-alert-handoff', source: 'alert', target: 'handoff' },
    { id: 'e-handoff-done', source: 'handoff', target: 'done' },
  ],
};
```
and add `alertWatcherAgentFlow` to the `AGENT_FLOWS` array. (Confirm each `kind` is in `MasterNodeKind`; recon verified `trigger/guard/llm/router/channel/intercept/end` all exist.)

- [ ] **Step 3: Add the test line** — in `src/lib/flows/agent-flows.test.ts`, add:
```ts
  it('resolves the Alert Watcher agent flow', () => {
    const flow = getMasterFlow('agent-alert-watcher');
    expect(flow).toBeTruthy();
    expect(flow?.nodes.some((n) => n.kind === 'llm')).toBe(true);
    expect(MASTER_FLOWS.some((f) => f.id === 'agent-alert-watcher')).toBe(false);
  });
```

- [ ] **Step 4: Add the Triage descriptor** — in `src/lib/server/system-agents/registry.ts`, import the helpers and add a descriptor to the array returned by `getSystemAgentDescriptors()` (after Reminders):

```ts
    {
      id: 'alert-watcher',
      moduleId: 'triage',
      name: m.sysagent_triage_name(),
      role: m.sysagent_triage_role(),
      description: m.sysagent_triage_desc(),
      avatarSeed: 'minion-alert-watcher',
      trigger: m.sysagent_triage_trigger(),
      managePath: null,
      flowId: 'agent-alert-watcher',
      async resolveStatus(ctx) {
        const summary = await gatewayCallAsUser<{ counts?: TriageArtifactData['counts'] }>(
          'plugins.alerts.summary',
          { since: Date.now() - 30 * 24 * 60 * 60 * 1000 },
          ctx.profileId,
        ).catch(() => null);
        if (!summary) return { enabled: true, state: 'attention', detail: 'Gateway unreachable' };
        return { enabled: true, state: 'active', detail: triageStatusDetail(summary.counts ?? null) };
      },
    },
```
Add imports: `import { gatewayCallAsUser } from '$lib/server/gateway-rpc';` and `import { triageStatusDetail, type TriageArtifactData } from '$lib/agents/artifacts';`. Note `managePath: null` — confirm the `SystemAgentMeta.managePath` type allows `null`; if it's typed `string`, widen it to `string | null` in `autonomous.ts` (and `systemMetaToVM` already passes it; `AutonomousAgentVM.managePath` is already `string | null`).

- [ ] **Step 5: Verify** — `bun run i18n:compile && bun run check` → 0; `bun run test -- src/lib/flows/agent-flows.test.ts` → PASS.

- [ ] **Step 6: Commit**
```bash
git add src/lib/server/system-agents/registry.ts src/lib/flows/master-flows.ts src/lib/flows/agent-flows.test.ts messages/en.json messages/es.json
git -c commit.gpgsign=false commit -m "feat(triage): Triage system agent + representative flow"
```

---

### Task 4: Artifact registry — triage artifact + gateway-fed context

**Files:** Modify `src/lib/server/artifacts/registry.ts`, `src/routes/api/artifacts/[id]/context/+server.ts`.

**Interfaces:** `getArtifactsForAgent('alert-watcher')` returns the triage descriptor; `getArtifactContext(ctx, agentId, 'triage')` resolves via per-user gateway calls; the context route passes the user's profileId (via `ctx.profileId`).

> No new unit test (gateway-call glue; the pure mappers are tested in Task 2). Verified by `bun run check` + live.

- [ ] **Step 1: Branch `getArtifactsForAgent`** — in `src/lib/server/artifacts/registry.ts`:
```ts
export function getArtifactsForAgent(agentId: string): ArtifactDescriptor[] {
  if (agentId === 'alert-watcher')
    return [triageDescriptorFor(agentId, m.artifact_triage_title(), m.artifact_triage_desc())];
  return [overviewDescriptorFor(agentId, m.artifact_overview_title(), m.artifact_overview_desc())];
}
```
Add `triageDescriptorFor`, `mapRecentRows`, `type TriageArtifactData` to the `$lib/agents/artifacts` import; add `import { gatewayCallAsUser } from '$lib/server/gateway-rpc';`.

- [ ] **Step 2: Triage branch in `getArtifactContext`** — extend the resolver:
```ts
export async function getArtifactContext(
  ctx: CoreCtx,
  agentId: string,
  artifactId: string,
): Promise<ArtifactContext | null> {
  const vms = await loadSystemAgentVMs(ctx);
  const vm = vms.find((v) => v.id === agentId);
  if (!vm) return null;
  const base = agentVmToArtifactContext(vm);
  if (artifactId === 'overview') return base;
  if (artifactId === 'triage' && agentId === 'alert-watcher') {
    const [summary, recent] = await Promise.all([
      gatewayCallAsUser<{ counts?: TriageArtifactData['counts'] }>('plugins.alerts.summary', { since: Date.now() - 30 * 24 * 60 * 60 * 1000 }, ctx.profileId).catch(() => null),
      gatewayCallAsUser<{ rows?: Array<Record<string, unknown>> }>('plugins.alerts.recent', { limit: 10 }, ctx.profileId).catch(() => null),
    ]);
    const counts = summary?.counts ?? { total: 0, high: 0, med: 0, low: 0, notified: 0, responded: 0 };
    return { ...base, data: { counts, recent: mapRecentRows(recent?.rows ?? []) } };
  }
  return null;
}
```

- [ ] **Step 3: Pass profileId from the route** — the context API route already calls `getArtifactContext(ctx, agentId, params.id)` after `requireCoreCtx(locals)`. `ctx.profileId` is now populated (Task 1), so no route change is strictly needed — **confirm** `requireCoreCtx` returns the profileId-bearing ctx. If the route built ctx differently, ensure it uses `requireCoreCtx`. (No code change expected; verify only.)

- [ ] **Step 4: Verify** — `bun run check` → 0.

- [ ] **Step 5: Commit**
```bash
git add src/lib/server/artifacts/registry.ts
git -c commit.gpgsign=false commit -m "feat(triage): triage artifact descriptor + gateway-fed (per-user) context"
```

---

### Task 5: Triage artifact bundle + serving registration

**Files:** Create `src/lib/artifacts/builtin/triage/index.html`; Modify `src/routes/artifacts/[artifactId]/ui/[...path]/+server.ts`.

> No unit test (static asset). Implements the design contract; validated live.

- [ ] **Step 1: Write the bundle** — `src/lib/artifacts/builtin/triage/index.html` (self-contained, token-bound, same bridge client as the Overview artifact, but renders `context.data`: 4 KPI stat cards Total/High/Notified/Responded + a recent-alerts list with severity chips). Base it on the existing `src/lib/artifacts/builtin/overview/index.html` (copy its bridge-client `<script>` verbatim — same handshake/origin/rpc logic) and replace only the `render(c)` body + the markup to use `c.data.counts` and `c.data.recent`. Severity chip colors use `var(--color-success/warning, #hex)` fallbacks (never bare hex). Loading + error states identical to overview. If `c.data` is absent, show the empty state.

  (The implementer reads `overview/index.html` first and adapts it; the bridge protocol section must stay byte-identical so the handshake works.)

- [ ] **Step 2: Register the bundle** — in `src/routes/artifacts/[artifactId]/ui/[...path]/+server.ts`, add a `?raw` import + a `BUNDLES` entry:
```ts
import triageHtml from '$lib/artifacts/builtin/triage/index.html?raw';
// ... in BUNDLES:
  triage: { 'index.html': { body: triageHtml, type: 'text/html; charset=utf-8' } },
```

- [ ] **Step 3: Verify** — `bun run check` → 0.

- [ ] **Step 4: Commit**
```bash
git add src/lib/artifacts/builtin/triage/index.html "src/routes/artifacts/[artifactId]/ui/[...path]/+server.ts"
git -c commit.gpgsign=false commit -m "feat(triage): triage KPI + recent-alerts artifact bundle"
```

---

### Task 6: Hub-side de-plugin (hide alert-watcher as a plugin)

**Files:** Modify `src/lib/server/gateway-rpc.ts`, `src/lib/components/layout/sections.ts`.

> No unit test (filter glue); verified by `bun run check` + live (Alert Watcher gone from Settings→Plugins + nav).

- [ ] **Step 1: Filter pluginsUiList** — in `src/lib/server/gateway-rpc.ts`, define `const HIDDEN_PLUGIN_IDS = new Set(['alert-watcher', 'alerts']);` and in `pluginsUiList()`, filter the returned occupants: `.filter((e) => !HIDDEN_PLUGIN_IDS.has(e.pluginId))` with a comment: `// alert-watcher is surfaced as the Triage autonomous agent, not a plugin`.

- [ ] **Step 2: Remove the nav override** — in `src/lib/components/layout/sections.ts`, delete the `'alert-watcher': 'customer-support',` and `alerts: 'customer-support',` entries from `PLUGIN_CATEGORY_OVERRIDES`.

- [ ] **Step 3: Update the matching test** — `src/lib/state/plugin-nav.test.ts` asserts `pluginId: 'alerts'` lands in `customer-support`. With the override removed, that fixture would now fall through to the default category. Update the test: change its expectation to the default category (read what the default is — likely `'tool'`/`'integration'`) OR change the fixture's pluginId to a different still-overridden one. Make the test assert current behavior. Run `bun run test -- src/lib/state/plugin-nav.test.ts` → PASS.

- [ ] **Step 4: Verify** — `bun run check` → 0.

- [ ] **Step 5: Commit**
```bash
git add src/lib/server/gateway-rpc.ts src/lib/components/layout/sections.ts src/lib/state/plugin-nav.test.ts
git -c commit.gpgsign=false commit -m "feat(triage): de-plugin alert-watcher on the hub (filter pluginsUiList + nav)"
```

---

### Task 7: Full verification

- [ ] **Step 1:** `bun run i18n:compile && bun run check` → 0 errors / 0 warnings. Fix any new error in the touched files.
- [ ] **Step 2:** `bun run test` → green; new/updated specs pass (`artifacts.test.ts`, `agent-flows.test.ts`, `plugin-nav.test.ts`); the pre-existing `aci-backend.test.ts` git-env flake (if it appears) is unrelated — confirm no NEW failures.
- [ ] **Step 3: Live (best-effort)** — if a DB+gateway-connected dev instance is available, sign in as a FACES admin: Settings→Plugins no longer lists Alert Watcher; `/agents/autonomous` shows an **Alert Watcher** card (status detail like "N alerts · M high (30d)") with a `Megaphone` artifact tile; opening it shows the triage KPI cards + recent alerts; "View flow" opens `/flow-editor/master/agent-alert-watcher`. If no connected instance, note deferred (the gateway-call paths can't run without a live gateway).
- [ ] **Step 4:** Commit any fixes.

---

## Self-Review

**Spec coverage:** Triage system agent + gateway-fed status (T3) ✓; triage artifact descriptor + `data` + per-user gateway-fed context (T2 + T4) ✓; tenancy via `gatewayCallAsUser`+`CoreCtx.profileId` (T1 + T3 + T4) ✓; triage bundle (T5) ✓; serving registration (T5) ✓; de-plugin (pluginsUiList filter + nav override) (T6) ✓; representative flow + flowId (T3, phase-1.5 reconciliation) ✓; icon/description on triage descriptor (T2, reconciliation) ✓; i18n en/es (T3) ✓; pure-mapper tests (T2) + flow test (T3) ✓. Gallery rendering is automatic (roster load already feeds `artifactsByAgent`) — no extra task. Out-of-scope (ECharts dashboard, A2, settings surface) correctly absent.

**Placeholder scan:** none — complete code/commands. T5 instructs adapting the existing overview bundle (copy bridge client verbatim) rather than re-pasting 110 lines — concrete, with the exact render-body change named; not a placeholder.

**Type consistency:** `CoreCtx.profileId` (T1) consumed by `resolveStatus`/`getArtifactContext` (T3/T4). `TriageArtifactData`/`triageDescriptorFor`/`triageStatusDetail`/`mapRecentRows` (T2) consumed in T3/T4/T5. `gatewayCallAsUser(method, params, profileId)` used per its real signature. `getArtifactsForAgent`/`getArtifactContext` signatures unchanged (profileId rides on `ctx`). `flowId: 'agent-alert-watcher'` (T3) matches the `AGENT_FLOWS` id + the "View flow" route. `managePath: null` requires `SystemAgentMeta.managePath: string | null` — T3 step 4 calls for widening it if needed.
