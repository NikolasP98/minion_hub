# Flow Variable Export (5b.1) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let autonomous-agent flows declare exportable variables (universal keys) per node, persist an org-scoped editable on/off toggle, surface them in the flow viewer (read-only + admin-editable), and have the artifact context supply their live values — the data contract the builder (5b.2) consumes.

**Architecture:** `exports` property on `MasterFlowNode` (declaration) + a `flow_var_exports` RLS table (toggle) + pure `flowVariableSchema` (declared ∩ enabled) + per-agent `resolveVariables` feeding `ArtifactContext.vars` + a `FlowExports` panel/badge + a PATCH toggle API.

**Tech Stack:** SvelteKit 2, Svelte 5 runes, TypeScript, Drizzle (Postgres/Supabase gxv), `withOrgCore` (RLS), Paraglide, Vitest, Bun. Hub, branch `dev`.

## Global Constraints

- Svelte 5 runes only; TS strict, no `any`; no `@ts-nocheck`.
- i18n in BOTH `messages/en.json` + `messages/es.json`; `bun run i18n:compile` before `bun run check`.
- `bun run check` 0/0; `bun run test` green. Commits UNSIGNED (`git -c commit.gpgsign=false`); never `git add` a lockfile or `sdd/`.
- Svelte MCP autofixer on every new/edited `.svelte` before committing.
- **Tenancy:** all DB access via `withOrgCore({ db: getCoreDb(), tenantId: ctx.tenantId }, fn)` (RLS). Write API requires `requireAdmin(locals)`; routes resolve `requireCoreCtx(locals)`. Migration is applied to **prod gxv by the controller** (Task 3 hand-off), not a subagent.
- The universal variable `key` (e.g. `reminders.sent`) is the single identifier shared by declaration, toggle row, live value, and (later) artifact binding.

## Reference: verified shapes

- `src/lib/flows/master-flows.ts`: `MasterFlow { id, name, description, tags?, nodes: MasterFlowNode[], edges }`; `MasterFlowNode { id, kind, title, subtitle?, position, branches? }`; `AGENT_FLOWS = [remindersAgentFlow, alertWatcherAgentFlow]`; `getMasterFlow(id)`. Reminders flow id `agent-reminders`, nodes incl. `done` ("sent / failed / skipped"). Alert-watcher flow id `agent-alert-watcher`, nodes incl. `route` (severity router) + `handoff`.
- System-agent registry `src/lib/server/system-agents/registry.ts`: `getSystemAgentDescriptors()` → descriptors `{ id, moduleId, name, role, description, avatarSeed, trigger, managePath, flowId, resolveStatus(ctx) }`. Reminders descriptor `id: 'scheduling.reminders'`, `flowId: 'agent-reminders'`; uses `getReminderActivity` (`$server/services/reminders.service`). Alert-watcher `id: 'alert-watcher'`, `flowId: 'agent-alert-watcher'`; uses `gatewayCallAsUser('plugins.alerts.summary'/'recent', …, ctx.profileId)`.
- `getArtifactContext(ctx, agentId, artifactId)` (`src/lib/server/artifacts/registry.ts`): loads `loadSystemAgentVMs(ctx)`, `base = agentVmToArtifactContext(vm)`. `ArtifactContext` in `src/lib/agents/artifacts.ts`.
- DB/RLS: 5a's `pg-artifacts-schema.ts` + `store.ts` (withOrgCore) + meta-repo migration `20260619190000_agent_artifacts.sql` are the exact patterns. `getCoreDb` (`$server/db/pg-client`); `withOrgCore` (`$server/db/with-org-core`); `requireAdmin`/`requireCoreCtx`.
- Autonomous loads: `(app)/agents/autonomous/+page.server.ts` (roster, builds `artifactsByAgent`, has ctx) + `[id]/+page.server.ts` (detail). Flow viewer `MasterFlowCanvas.svelte` ({ flow }); flow window rendered by `AgentWindowLayer.svelte`. Master route `(app)/flow-editor/master/[id]/` has only `+page.svelte` (client-resolves via `getMasterFlow`).

---

### Task 1: Declaration — `VariableSpec` + node `exports`

**Files:** Modify `src/lib/flows/master-flows.ts`, `src/lib/flows/agent-flows.test.ts`.

**Interfaces — Produces:** `VariableType`, `VariableSpec`, `MasterFlowNode.exports?: VariableSpec[]`, `flowExportedSpecs(flow): VariableSpec[]`.

- [ ] **Step 1: Types + node field** — in `master-flows.ts`:
```ts
export type VariableType = 'int' | 'float' | 'string' | 'date' | 'list' | 'enum';
export interface VariableSpec {
  key: string;               // universal id, unique within a flow
  type: VariableType;
  label: string;
  description?: string;
  sample?: unknown;
  defaultExported?: boolean;  // enabled state when no toggle row exists; default true
}
```
Add `exports?: VariableSpec[];` to the `MasterFlowNode` interface.

- [ ] **Step 2: Declare exports on the agent flows** — add `exports` to the relevant nodes:
  - `agent-reminders` `done` node: `exports: [ { key: 'reminders.sent', type: 'int', label: 'Sent', sample: 42 }, { key: 'reminders.failed', type: 'int', label: 'Failed', sample: 1 }, { key: 'reminders.skipped', type: 'int', label: 'Skipped', sample: 7 } ]`.
  - `agent-alert-watcher` `route` node: `exports: [ { key: 'triage.counts.total', type: 'int', label: 'Total alerts', sample: 12 }, { key: 'triage.counts.high', type: 'int', label: 'High severity', sample: 3 } ]`; `handoff` node: `exports: [ { key: 'triage.recent', type: 'list', label: 'Recent alerts', sample: [] } ]`.

- [ ] **Step 3: `flowExportedSpecs`** — add:
```ts
export function flowExportedSpecs(flow: MasterFlow): VariableSpec[] {
  return flow.nodes.flatMap((n) => n.exports ?? []);
}
```

- [ ] **Step 4: Test** — in `agent-flows.test.ts` add:
```ts
import { flowExportedSpecs, getMasterFlow } from './master-flows';
it('agent flows declare exported variables with unique keys', () => {
  for (const id of ['agent-reminders', 'agent-alert-watcher']) {
    const specs = flowExportedSpecs(getMasterFlow(id)!);
    expect(specs.length).toBeGreaterThan(0);
    expect(new Set(specs.map((s) => s.key)).size).toBe(specs.length); // unique
  }
});
```

- [ ] **Step 5: Verify + commit** — `bun run test -- src/lib/flows/agent-flows.test.ts` PASS; `bun run check` 0.
```bash
git add src/lib/flows/master-flows.ts src/lib/flows/agent-flows.test.ts
git -c commit.gpgsign=false commit -m "feat(flows): per-node exports (VariableSpec) declared on agent flows"
```

---

### Task 2: Effective schema (pure)

**Files:** Create `src/lib/flows/flow-variables.ts`, `src/lib/flows/flow-variables.test.ts`.

**Interfaces — Produces:** `ExportedVariable` (`VariableSpec & { enabled: boolean }`); `resolveFlowVariables(specs, toggles): ExportedVariable[]`; `flowVariableSchema(specs, toggles): VariableSpec[]` (enabled only).

- [ ] **Step 1: Failing test** — `flow-variables.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { resolveFlowVariables, flowVariableSchema } from './flow-variables';
import type { VariableSpec } from './master-flows';
const specs: VariableSpec[] = [
  { key: 'a', type: 'int', label: 'A' },                          // default → enabled
  { key: 'b', type: 'int', label: 'B', defaultExported: false },  // default → disabled
];
describe('resolveFlowVariables', () => {
  it('applies toggle over defaultExported', () => {
    const r = resolveFlowVariables(specs, { b: true, a: false });
    expect(r.find((v) => v.key === 'a')!.enabled).toBe(false); // toggle wins
    expect(r.find((v) => v.key === 'b')!.enabled).toBe(true);
  });
  it('falls back to defaultExported (default true)', () => {
    const r = resolveFlowVariables(specs, {});
    expect(r.find((v) => v.key === 'a')!.enabled).toBe(true);
    expect(r.find((v) => v.key === 'b')!.enabled).toBe(false);
  });
});
describe('flowVariableSchema', () => {
  it('returns only enabled specs', () => {
    expect(flowVariableSchema(specs, {}).map((s) => s.key)).toEqual(['a']);
  });
});
```

- [ ] **Step 2: Run red** — `bun run test -- src/lib/flows/flow-variables.test.ts` → FAIL.

- [ ] **Step 3: Implement** — `flow-variables.ts`:
```ts
import type { VariableSpec } from './master-flows';
export interface ExportedVariable extends VariableSpec { enabled: boolean }
function isEnabled(spec: VariableSpec, toggles: Record<string, boolean>): boolean {
  return toggles[spec.key] ?? spec.defaultExported ?? true;
}
export function resolveFlowVariables(specs: VariableSpec[], toggles: Record<string, boolean>): ExportedVariable[] {
  return specs.map((s) => ({ ...s, enabled: isEnabled(s, toggles) }));
}
export function flowVariableSchema(specs: VariableSpec[], toggles: Record<string, boolean>): VariableSpec[] {
  return specs.filter((s) => isEnabled(s, toggles));
}
```

- [ ] **Step 4: Run green + commit** — test PASS; `bun run check` 0.
```bash
git add src/lib/flows/flow-variables.ts src/lib/flows/flow-variables.test.ts
git -c commit.gpgsign=false commit -m "feat(flows): pure resolveFlowVariables + flowVariableSchema (declared ∩ toggles)"
```

---

### Task 3: Toggle table + migration

**Files:** Create `src/server/db/pg-flow-exports-schema.ts`; Create (META-REPO ROOT) `/home/nikolas/Documents/CODE/MINION/supabase/migrations/20260620120000_flow_var_exports.sql`.

**Interfaces — Produces:** `flowVarExports` table; `FlowVarExportRow`.

- [ ] **Step 1: Drizzle table** — `pg-flow-exports-schema.ts`:
```ts
import { pgTable, uuid, text, boolean, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';

/** Per-org on/off toggle for a flow's exported variables. Structure (which vars a
 *  flow CAN export) is code-declared on MasterFlowNode.exports; this only persists
 *  the enabled state. Org isolation via withOrgCore (app_ledger + GUC). */
export const flowVarExports = pgTable(
  'flow_var_exports',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: text('org_id').notNull(),
    flowId: text('flow_id').notNull(),
    varKey: text('var_key').notNull(),
    enabled: boolean('enabled').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ uniq: uniqueIndex('flow_var_exports_org_flow_key_uniq').on(t.orgId, t.flowId, t.varKey) }),
);
export type FlowVarExportRow = typeof flowVarExports.$inferSelect;
```

- [ ] **Step 2: Migration** (absolute meta-repo path):
```sql
-- Per-org toggle state for flow exported variables (declaration is code-side).
create table if not exists public.flow_var_exports (
  id         uuid primary key default gen_random_uuid(),
  org_id     text not null,
  flow_id    text not null,
  var_key    text not null,
  enabled    boolean not null,
  updated_at timestamptz not null default now()
);
create unique index if not exists flow_var_exports_org_flow_key_uniq on public.flow_var_exports (org_id, flow_id, var_key);
grant select, insert, update, delete on public.flow_var_exports to app_ledger;
alter table public.flow_var_exports enable row level security;
alter table public.flow_var_exports force  row level security;
create policy flow_var_exports_org_guc on public.flow_var_exports
  for all using (org_id = current_setting('app.current_org_id', true))
          with check (org_id = current_setting('app.current_org_id', true));
```

- [ ] **Step 3: Verify + commit** — `bun run check` 0 (table typechecks). Commit ONLY the hub schema:
```bash
git add src/server/db/pg-flow-exports-schema.ts
git -c commit.gpgsign=false commit -m "feat(flows): flow_var_exports Drizzle table + migration"
```

> **CONTROLLER HAND-OFF:** commit the migration in the meta-repo + apply to **gxv** (`mcp__supabase__apply_migration`), verify forced RLS, before Task 4's live use. Tasks 2-7 typecheck without the live table.

---

### Task 4: Toggle store

**Files:** Create `src/lib/server/flows/exports-store.ts`.

**Interfaces — Produces:** `listExportToggles(ctx, flowId): Promise<Record<string, boolean>>`; `setExportToggle(ctx, flowId, varKey, enabled): Promise<void>`.

> No unit test (DB glue; verified by `bun run check` + live). Mirrors 5a's store.

- [ ] **Step 1: Implement** — `exports-store.ts`:
```ts
import { eq, and } from 'drizzle-orm';
import type { CoreCtx } from '$server/auth/core-ctx';
import { getCoreDb } from '$server/db/pg-client';
import { withOrgCore } from '$server/db/with-org-core';
import { flowVarExports } from '$server/db/pg-flow-exports-schema';

const scope = (ctx: CoreCtx) => ({ db: getCoreDb(), tenantId: ctx.tenantId });

export function listExportToggles(ctx: CoreCtx, flowId: string): Promise<Record<string, boolean>> {
  return withOrgCore(scope(ctx), async (tx) => {
    const rows = await tx
      .select({ varKey: flowVarExports.varKey, enabled: flowVarExports.enabled })
      .from(flowVarExports)
      .where(and(eq(flowVarExports.orgId, ctx.tenantId), eq(flowVarExports.flowId, flowId)));
    return Object.fromEntries(rows.map((r) => [r.varKey, r.enabled]));
  });
}

export function setExportToggle(ctx: CoreCtx, flowId: string, varKey: string, enabled: boolean): Promise<void> {
  return withOrgCore(scope(ctx), async (tx) => {
    await tx
      .insert(flowVarExports)
      .values({ orgId: ctx.tenantId, flowId, varKey, enabled })
      .onConflictDoUpdate({
        target: [flowVarExports.orgId, flowVarExports.flowId, flowVarExports.varKey],
        set: { enabled, updatedAt: new Date() },
      });
  });
}
```

- [ ] **Step 2: Verify + commit** — `bun run check` 0.
```bash
git add src/lib/server/flows/exports-store.ts
git -c commit.gpgsign=false commit -m "feat(flows): org-scoped flow export toggle store (list + upsert)"
```

---

### Task 5: Live values — context `vars`

**Files:** Modify `src/lib/agents/artifacts.ts`, `src/lib/server/system-agents/registry.ts`, `src/lib/server/artifacts/registry.ts`.

**Interfaces — Produces:** `ArtifactContext.vars?: Record<string, unknown>`; per-descriptor `resolveVariables?(ctx, keys): Promise<Record<string, unknown>>`; `getArtifactContext` sets `vars`.

- [ ] **Step 1: Context field** — in `artifacts.ts`, add `vars?: Record<string, unknown>;` to `ArtifactContext`.

- [ ] **Step 2: Per-agent value providers** — in `registry.ts` (system-agents), add a `resolveVariables(ctx, keys)` to the reminders + alert-watcher descriptors (only return requested keys; `.catch` → omit). Widen `SystemAgentMeta` with optional `resolveVariables?(ctx: CoreCtx, keys: string[]): Promise<Record<string, unknown>>` (in `autonomous.ts`):
  - reminders: `const act = await getReminderActivity(ctx).catch(() => null);` map `reminders.sent/failed/skipped` from it (use the same fields its status uses). Return only keys present in `keys`.
  - alert-watcher: `gatewayCallAsUser('plugins.alerts.summary', { since: Date.now()-30*864e5 }, ctx.profileId).catch(()=>null)` → `triage.counts.total/high`; for `triage.recent`, `plugins.alerts.recent` (reuse `mapRecentRows`). Return only requested keys.

- [ ] **Step 3: getArtifactContext sets vars** — in `artifacts/registry.ts`, after computing `base`/the artifact branch, compute the agent's exported schema + live values and attach to the returned context:
```ts
import { getMasterFlow, flowExportedSpecs } from '$lib/flows/master-flows';
import { flowVariableSchema } from '$lib/flows/flow-variables';
import { listExportToggles } from '$lib/server/flows/exports-store';
import { getSystemAgentDescriptors } from '$lib/server/system-agents/registry';
// helper used by every returned context:
async function withVars(ctx: CoreCtx, agentId: string, context: ArtifactContext): Promise<ArtifactContext> {
  const desc = getSystemAgentDescriptors().find((d) => d.id === agentId);
  if (!desc?.flowId || !desc.resolveVariables) return context;
  const flow = getMasterFlow(desc.flowId);
  if (!flow) return context;
  const specs = flowExportedSpecs(flow);
  if (!specs.length) return context;
  const toggles = await listExportToggles(ctx, desc.flowId).catch(() => ({}));
  const enabled = flowVariableSchema(specs, toggles).map((s) => s.key);
  if (!enabled.length) return context;
  const vars = await desc.resolveVariables(ctx, enabled).catch(() => ({}));
  return { ...context, vars };
}
```
Wrap each non-null return of `getArtifactContext` in `await withVars(ctx, agentId, …)`. (`getSystemAgentDescriptors()` is localized/cheap; reuse the existing import or add it.)

- [ ] **Step 4: Verify + commit** — `bun run check` 0; existing artifact/registry tests green.
```bash
git add src/lib/agents/artifacts.ts src/lib/server/system-agents/registry.ts src/lib/server/artifacts/registry.ts src/lib/agents/autonomous.ts
git -c commit.gpgsign=false commit -m "feat(flows): artifact context vars — live values for enabled exported variables"
```

---

### Task 6: Toggle API

**Files:** Create `src/routes/api/flows/[flowId]/exports/+server.ts`.

> No unit test (route glue); admin-gating + org-scope + validation verified live.

- [ ] **Step 1: PATCH** —
```ts
import type { RequestHandler } from './$types';
import { json, error } from '@sveltejs/kit';
import { requireAdmin } from '$server/auth/authorize';
import { requireCoreCtx } from '$server/auth/core-ctx';
import { setExportToggle } from '$lib/server/flows/exports-store';
import { getMasterFlow, flowExportedSpecs } from '$lib/flows/master-flows';

export const PATCH: RequestHandler = async ({ locals, params, request }) => {
  requireAdmin(locals);
  const ctx = await requireCoreCtx(locals);
  const body = (await request.json().catch(() => null)) as { varKey?: string; enabled?: boolean } | null;
  if (!body?.varKey || typeof body.enabled !== 'boolean') throw error(400, 'varKey + enabled required');
  const flow = getMasterFlow(params.flowId);
  const known = flow ? flowExportedSpecs(flow).some((s) => s.key === body.varKey) : false;
  if (!known) throw error(400, 'unknown varKey for this flow');
  await setExportToggle(ctx, params.flowId, body.varKey, body.enabled);
  return json({ ok: true });
};
```

- [ ] **Step 2: Verify + commit** — `bun run check` 0.
```bash
git add "src/routes/api/flows/[flowId]/exports/+server.ts"
git -c commit.gpgsign=false commit -m "feat(flows): PATCH flow export toggle (admin, org-scoped, validated)"
```

---

### Task 7: Surfaces — `FlowExports` panel + badge + wiring + i18n

**Files:** Create `src/lib/components/flow-editor/FlowExports.svelte`; Modify `src/lib/components/flow-editor/MasterFlowCanvas.svelte`, `src/lib/components/agents/AgentWindowLayer.svelte`, `src/routes/(app)/agents/autonomous/+page.server.ts`, `[id]/+page.server.ts`, `messages/en.json`, `messages/es.json`.

- [ ] **Step 1: i18n** — both locales: `flow_exports_label` ("Exported variables"/"Variables exportadas"), `flow_exports_badge` ("{n} exported"/"{n} exportadas"), `flow_exports_none` ("No exported variables"/"Sin variables exportadas").

- [ ] **Step 2: Load toggles** — in `(app)/agents/autonomous/+page.server.ts`: for each system agent with a `flowId`, `listExportToggles(ctx, flowId)`; return `flowTogglesByAgent: Record<agentId, Record<varKey, boolean>>` (Promise.all). Same in `[id]/+page.server.ts` for the single agent. (ctx already resolved there from 5a.)

- [ ] **Step 3: `FlowExports.svelte`** — props `{ flowId, specs: VariableSpec[], toggles: Record<string, boolean>, canEdit }`. Uses `resolveFlowVariables(specs, toggles)` to list each variable: label + key (mono) + type chip + a toggle (`<button role="switch">` or a checkbox). When `canEdit`, toggling `PATCH`es `/api/flows/${flowId}/exports` `{varKey, enabled}` and optimistically updates local state; on non-2xx revert. When `!canEdit`, toggles render `disabled`. Empty → `flow_exports_none`. Svelte 5 runes, token-styled.

- [ ] **Step 4: Badge in the flow window** — in `AgentWindowLayer.svelte` flow branch: compute `specs = flowExportedSpecs(flow)`; if `specs.length`, render an **"N exported" badge** (in the fullscreen chrome row + a small affordance windowed) that toggles a local `showExports` to reveal `<FlowExports {flowId} {specs} toggles={...} canEdit={isAdmin} />` as a side panel/popover over the canvas. The flow window needs `flowId` (= `w.flowId`), the agent's toggle map, and `isAdmin` — thread these into the window: extend the `AgentWindow`/layer inputs minimally, OR have `AgentWindowLayer` read them from `page.data` (`flowTogglesByAgent`, `isAdmin`). Prefer reading `page.data` (no store change).

- [ ] **Step 5: MasterFlowCanvas marker (optional, cheap)** — nodes whose `flow.nodes[i].exports?.length` show a tiny "exported" dot/badge on the node. If SvelteFlow node templating makes this costly, SKIP (the window badge + panel is the required surface) and note it.

- [ ] **Step 6: Validate + verify** — Svelte autofixer on `FlowExports.svelte` + `AgentWindowLayer.svelte` (+ MasterFlowCanvas if touched). `bun run i18n:compile && bun run check` 0.

- [ ] **Step 7: Commit**
```bash
git add src/lib/components/flow-editor/FlowExports.svelte src/lib/components/flow-editor/MasterFlowCanvas.svelte src/lib/components/agents/AgentWindowLayer.svelte "src/routes/(app)/agents/autonomous/+page.server.ts" "src/routes/(app)/agents/autonomous/[id]/+page.server.ts" messages/en.json messages/es.json
git -c commit.gpgsign=false commit -m "feat(flows): FlowExports panel + exported badge in the flow window (read-only + admin toggle)"
```

---

### Task 8: Full verification

- [ ] **Step 1:** `bun run i18n:compile && bun run check` → 0/0.
- [ ] **Step 2:** `bun run test` → green; `flow-variables.test.ts` + `agent-flows.test.ts` pass; pre-existing `aci-backend.test.ts` git-env flake (if any) is unrelated — confirm no NEW failures.
- [ ] **Step 3: Live (best-effort, needs the migration applied)** — open an agent's flow window: an "N exported" badge lists its variables; as admin, toggling one persists (reload-stable, org-scoped); a non-admin sees them read-only; the agent's artifact context now carries `vars` for enabled keys. If no instance, note deferred.
- [ ] **Step 4:** Commit any fixes.

---

## Self-Review

**Spec coverage:** declaration (`VariableSpec` + node `exports` + agent-flow declarations + `flowExportedSpecs`) T1 ✓; effective schema (`resolveFlowVariables`/`flowVariableSchema`) T2 ✓; toggle table + migration (forced RLS, gxv) T3 ✓; toggle store (list + upsert, withOrgCore) T4 ✓; live values (`ArtifactContext.vars` + per-agent `resolveVariables` + `getArtifactContext` wiring) T5 ✓; PATCH toggle API (admin, validated) T6 ✓; surfaces (`FlowExports` panel + window badge, read-only + admin-editable) + toggle loads + i18n T7 ✓; pure-helper + flow tests T2/T1 ✓. Out-of-scope (5b.2 builder, structure editing, non-agent flows) absent. Universal key threads declaration→toggle→value→(future binding).

**Placeholder scan:** none — complete code/commands. The migration `20260620120000` timestamp is concrete. T5 step 2 says "use the same fields its status uses" for reminders — the implementer reads the reminders descriptor's existing stat fields; named, not vague. T5 step 3 wraps returns in `withVars` — explicit helper given.

**Type consistency:** `VariableSpec`/`flowExportedSpecs` (T1) consumed by `flow-variables` (T2), `getArtifactContext` (T5), the API validation (T6), `FlowExports` (T7). `listExportToggles`/`setExportToggle` (T4) consumed by T5 + T6. `ArtifactContext.vars` (T5). `resolveVariables` added to `SystemAgentMeta` (T5) + used in T5. `flow_var_exports` columns (T3) match the store (T4). Reminders agentId is `scheduling.reminders` (not `reminders`); universal keys are independent of agentId.
