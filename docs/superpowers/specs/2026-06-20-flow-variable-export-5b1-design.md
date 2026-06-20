# Flow Variable Export (Subsystem 5b.1)

**Date:** 2026-06-20
**Status:** Approved design — ready for implementation plan
**Scope:** Subsystem **5b.1** of the artifact-builder roadmap (#5). Give autonomous-agent
flows an **export** mechanism: each flow node declares the variables it exposes
(by a **universal identifier**), admins can **toggle** which are exported (persisted,
org-scoped), the flow viewer surfaces them (read-only + editable), and the artifact
context resolver supplies their **live values** under those same keys. This is the
durable data contract the hub-side artifact **builder (5b.2)** will consume; it is
not the builder itself.

## Context (verified)

- Autonomous agents render a **representative read-only** `MasterFlow`
  (`src/lib/flows/master-flows.ts`): `MasterFlowNode { id, kind, title, subtitle?,
  position, branches? }`; `AGENT_FLOWS` holds the per-agent flows
  (`agent-reminders`, `agent-alert-watcher`); `getMasterFlow(id)` resolves
  `MASTER_FLOWS ∪ AGENT_FLOWS`. `MasterFlowCanvas.svelte` ({ flow }) renders them
  read-only (SvelteFlow). The viewer is reached via `/flow-editor/master/[id]` and
  the draggable flow windows (`AgentWindowLayer`).
- Artifacts get data through the bridge context (`getArtifactContext(ctx, agentId,
  artifactId)` → `ArtifactContext`), resolved per agent in
  `src/lib/server/artifacts/registry.ts`. Triage already supplies `data` via
  per-user gateway calls; reminders exposes `stats` on its status.
- Tenancy: `withOrgCore({ db: getCoreDb(), tenantId }, fn)` (forced RLS via the
  `app.current_org_id` GUC); migrations at the **meta-repo root**
  `supabase/migrations/<ts>_*.sql` (grant to `app_ledger` + enable/force RLS +
  `<table>_org_guc` policy), applied to gxv. `requireAdmin(locals)` /
  `requireCoreCtx(locals)` (`CoreCtx { db, tenantId, profileId? }`). 5a's store
  (`src/lib/server/artifacts/store.ts`) is the pattern to mirror.

## Decisions (confirmed)

- **Per-node `export` property** (not a dedicated exporter node) — ponytail-vetted:
  no new node kind, variables live on the node that produces them, one universal key
  threads declaration → value → binding. (Godot-style `@export` per property.)
- **Toggle-able + editable + read-only.** Variables are declared in code (the
  catalog of what *can* be exported, with a `defaultExported`); the *enabled* state
  is **persisted per-org** in a small table so it's editable without making the
  representative flow itself editable. The viewer shows badges (read-only) and, for
  admins, per-variable toggles (editable → persists).
- **Universal identifier.** The variable `key` (e.g. `reminders.sent`,
  `triage.counts.high`) is stable and shared by the node declaration, the live-value
  provider, and (later) the generated artifact's binding.
- Hub-side; the gateway MCP (#4) is **not** used here.

## Architecture

### 1. Declaration — `VariableSpec` + `MasterFlowNode.exports`

`src/lib/flows/master-flows.ts`:
```ts
export type VariableType = 'int' | 'float' | 'string' | 'date' | 'list' | 'enum';
export interface VariableSpec {
  key: string;            // universal id, e.g. 'reminders.sent' (unique within a flow)
  type: VariableType;
  label: string;
  description?: string;
  sample?: unknown;       // example value for the builder + viewer
  defaultExported?: boolean; // default enabled state when no toggle row exists (default true)
}
```
`MasterFlowNode` gains `exports?: VariableSpec[]`. Declare exports on the
`AGENT_FLOWS` nodes where the data is produced:
- `agent-reminders`: the process/send nodes → `reminders.sent` (int),
  `reminders.failed` (int), `reminders.skipped` (int), `reminders.nextRun` (date).
- `agent-alert-watcher`: the router → `triage.counts.total` (int),
  `triage.counts.high` (int); the handoff → `triage.recent` (list).

A pure helper `flowExportedSpecs(flow): VariableSpec[]` = the union of all nodes'
`exports` (the catalog; toggles applied separately).

### 2. Toggle persistence — `flow_var_exports`

`src/server/db/pg-flow-exports-schema.ts` + meta-repo migration
`supabase/migrations/<ts>_flow_var_exports.sql` (forced RLS):
```
flow_var_exports(
  id uuid pk default gen_random_uuid(),
  org_id text not null,
  flow_id text not null,        -- MasterFlow id, e.g. 'agent-reminders'
  var_key text not null,        -- the universal identifier
  enabled boolean not null,
  updated_by text,
  updated_at timestamptz not null default now(),
  unique (org_id, flow_id, var_key)
)
```
(Toggles are keyed by `(flow_id, var_key)` — the universal key already implies its
node, so `node_id` is not stored; YAGNI.) Forced RLS by `org_id`; applied to gxv.

Store `src/lib/server/flows/exports-store.ts` (mirrors 5a's store, all via
`withOrgCore`):
- `listExportToggles(ctx, flowId): Promise<Record<string, boolean>>` (var_key → enabled).
- `setExportToggle(ctx, flowId, varKey, enabled): Promise<void>` (upsert on the unique key).

### 3. Effective schema — declared ∩ toggles

Pure helper `src/lib/flows/flow-variables.ts`:
```ts
export interface ExportedVariable extends VariableSpec { enabled: boolean }
export function resolveFlowVariables(specs: VariableSpec[], toggles: Record<string, boolean>): ExportedVariable[];
export function flowVariableSchema(specs: VariableSpec[], toggles: Record<string, boolean>): VariableSpec[]; // enabled only
```
`enabled = toggles[key] ?? (spec.defaultExported ?? true)`. Unit-tested.
`flowVariableSchema` (enabled-only) is what 5b.2's builder consumes.

### 4. Live values — context `vars`

Each autonomous agent maps its universal keys → live values. Add to the
system-agent registry a per-agent `resolveVariables(ctx, keys: string[]): Promise<Record<string, unknown>>`
(optional; agents without it expose nothing):
- reminders: reads its stats (`reminders.sent/failed/skipped/nextRun`).
- alert-watcher: `gatewayCallAsUser('plugins.alerts.summary', …, ctx.profileId)` →
  `triage.counts.total/high`; `…recent` → `triage.recent` (reuse the existing triage
  resolver logic; `.catch` → omit).

`ArtifactContext` (`src/lib/agents/artifacts.ts`) gains `vars?: Record<string, unknown>`.
`getArtifactContext` computes the agent's enabled schema (declared ∩ toggles) and
calls `resolveVariables(ctx, enabledKeys)` → sets `context.vars` (keyed by universal
id). Built-in artifacts ignore `vars`; generated artifacts (5b.2) bind to it. All
gateway/DB calls `.catch`-guarded.

### 5. Surfaces — viewer badge + toggle (read-only + editable)

`src/lib/components/flow-editor/FlowExports.svelte` (new): given `flowId`, the
flow's declared specs, the toggle map, and `canEdit`, renders the exportable
variables — each row: key/label/type + a toggle. `canEdit` (admin) → toggling calls
`PATCH /api/flows/[flowId]/exports` and optimistically updates; otherwise the
toggles render disabled (read-only). `MasterFlowCanvas.svelte` (or the viewer chrome
around it) shows an **"N exported" badge** that opens this panel; nodes with exports
get a small marker. The roster/detail loads provide the specs + toggles; the master
viewer page + the flow window pass them through.

### 6. API

`src/routes/api/flows/[flowId]/exports/+server.ts` (admin, org-scoped):
- `PATCH` body `{ varKey, enabled }` → `requireAdmin` + `requireCoreCtx` →
  `setExportToggle(ctx, flowId, varKey, enabled)` → `json({ ok: true })`. (Validates
  `varKey` belongs to the flow's declared specs; 400 otherwise.)
- (List is delivered via the page load, not a separate GET.)

## Components & files

| File | Change |
|---|---|
| `src/lib/flows/master-flows.ts` | EDIT — `VariableSpec`/`VariableType`; `MasterFlowNode.exports?`; declare exports on `agent-reminders` + `agent-alert-watcher` nodes; `flowExportedSpecs(flow)` |
| `src/lib/flows/flow-variables.ts` | NEW — `resolveFlowVariables` + `flowVariableSchema` (pure) |
| `src/lib/flows/flow-variables.test.ts` | NEW — unit tests (toggle default, enabled filter) |
| `src/server/db/pg-flow-exports-schema.ts` | NEW — `flow_var_exports` Drizzle table |
| `supabase/migrations/<ts>_flow_var_exports.sql` | NEW (meta-repo root) — table + forced RLS (applied to gxv by the controller) |
| `src/lib/server/flows/exports-store.ts` | NEW — `listExportToggles` + `setExportToggle` (withOrgCore) |
| `src/lib/agents/artifacts.ts` | EDIT — `ArtifactContext.vars?: Record<string, unknown>` |
| `src/lib/server/system-agents/registry.ts` | EDIT — per-agent `resolveVariables(ctx, keys)` for reminders + alert-watcher |
| `src/lib/server/artifacts/registry.ts` | EDIT — `getArtifactContext` computes enabled schema + sets `context.vars` |
| `src/lib/components/flow-editor/FlowExports.svelte` | NEW — exported-variables list + per-var toggle (read-only/editable) |
| `src/lib/components/flow-editor/MasterFlowCanvas.svelte` | EDIT — "N exported" badge / node marker → opens FlowExports |
| `src/lib/components/agents/AgentWindowLayer.svelte` | EDIT — pass flow specs/toggles + canEdit into the flow window |
| `src/routes/(app)/agents/autonomous/+page.server.ts`, `[id]/+page.server.ts` | EDIT — load toggle maps per agent flow |
| `src/routes/(app)/flow-editor/master/[id]/+page.server.ts` (+`.svelte`) | EDIT — load specs + toggles; render the badge/panel |
| `src/routes/api/flows/[flowId]/exports/+server.ts` | NEW — `PATCH` toggle (admin, org-scoped) |
| `messages/en.json`, `messages/es.json` | EDIT — export labels (exported / variables / toggle) |

## Out of scope (later)

- **5b.2** — the builder LLM that consumes `flowVariableSchema` to generate bundles.
- Editing flow *structure* / declaring new variables from the UI (declaration stays
  in code; only the enabled toggle is editable).
- Export on real editable `FlowCanvas` flows / non-agent flows (this targets the
  autonomous-agent representative flows).
- Per-variable transforms, computed/derived variables, value history.

## Testing

- `flow-variables.ts`: unit-test `resolveFlowVariables`/`flowVariableSchema`
  (default-exported fallback, explicit enable/disable, enabled-only filter). (vitest)
- `master-flows.ts`: extend `agent-flows.test.ts` — exported flows declare
  `exports` with unique keys; `flowExportedSpecs` unions them.
- Store + resolver + API are DB/gateway glue — `bun run check` + live (toggle
  persists org-scoped; `vars` populates; cross-org isolation).
- i18n parity en/es; Svelte autofixer on new/edited `.svelte`.

## Success criteria

- An autonomous agent's flow declares exportable variables (universal keys); the
  flow viewer shows an **"N exported" badge** and lists each variable.
- An **admin** can toggle a variable's export on/off; it **persists** (org-scoped,
  survives reload); a non-admin sees the toggles read-only.
- `getArtifactContext` returns `vars` = enabled exported keys → live values
  (reminders stats, triage counts/recent), org-scoped and `.catch`-guarded.
- `flowVariableSchema(specs, toggles)` yields the enabled schema 5b.2 will consume.
- `bun run check` clean; the pure-helper unit tests pass; migration applied to gxv.
