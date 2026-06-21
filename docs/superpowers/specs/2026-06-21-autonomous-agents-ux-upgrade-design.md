# Autonomous Agents UX upgrade (design)

**Date:** 2026-06-21 · **Scope:** `minion_hub` — autonomous agents list card + detail page.
**Phases 1–3 only.** Phase 4 (flow-builder copilot + MCP) is a separate follow-up project (decoupled; targets DB user-flows, not these code-defined system agents).

## Context
- Autonomous agents render via `AutonomousAgentCard.svelte` (list) and `/agents/autonomous/[id]/+page.svelte` (detail).
- Their flows (`flowId: 'agent-reminders'` …) are **read-only, code-authored** documentation diagrams (`master-flows.ts`) — NOT editable, NOT persisted. Logic lives in gateway/hub code.
- `MasterFlowCanvas.svelte` already renders a flow with pan/zoom and non-draggable nodes — i.e. it is already an interactive **view-only** canvas.
- Status today: an inline pill (`statusTone`/`statusLabel`) for state `active | attention | disabled`.
- Run telemetry: `flow_runs` (DB flows: `flowId, tenantId, startedAt, durationMs, status 'completed'|'error'`) + each VM's `status.state` and optional `status.stats {sent,failed,skipped}`.

## Phase 1 — Card polish (`AutonomousAgentCard.svelte`)

**StatusDot.svelte** (new, `src/lib/components/ui/`, shared): a colored dot that expands on hover/focus to reveal its label.
- Props: `state: 'active'|'attention'|'disabled'`, `label: string`.
- Dot color by state: active → `bg-emerald-400`, attention → `bg-amber-400`, disabled → `bg-white/30`.
- Expand: label span `max-w-0 opacity-0` → on `group-hover`/`group-focus-within` `max-w-[10rem] opacity-100`, `transition-all duration-200`, `overflow-hidden whitespace-nowrap`. Wrapper is `tabindex=0` + `aria-label={label}` for keyboard/SR (text always available to AT; only visually collapsed).
- Honors `prefers-reduced-motion` (no width animation → instant).

**Kebab menu**: replace the footer `View flow` + `Manage` buttons with a 3-dot (`MoreVertical`) trigger using the shared `Dropdown` (`$lib/components/ui`). Items: `View flow` (only if `agent.flowId`, → `agentWindows.openFlow`), `Manage` (→ `goto(/agents/autonomous/{id})`). Place dot + kebab top-right of the card header. Footer keeps only the stats/detail line.

## Phase 2 — Native health metric blocks (detail page only; NO new artifact)

**Server** `src/lib/server/agents/health-metrics.ts` → `getHealthMetrics(ctx, agent): HealthMetrics`:
```
type HealthMetrics = {
  state: 'active'|'attention'|'disabled';
  lastRunAt: number | null;     // ms epoch
  runs30d: number | null;
  successRate: number | null;   // 0..1
};
```
Resolution (graceful, "—" when null):
- `state` ← `agent.status.state` (always).
- If the agent has a **DB flow** (`agent.dbFlowId`): from `flow_runs` where `flowId = dbFlowId AND tenantId = ctx.tenantId AND startedAt >= now-30d` → `runs30d = count`, `successRate = completed/total`, `lastRunAt = max(startedAt)`.
- Else if `agent.status.stats` present (e.g. reminders): `runs30d = sent+failed+skipped`, `successRate = sent/(sent+failed)` (null if denom 0), `lastRunAt = null`.
- Else all null.

**Component** `src/lib/components/agents/AgentHealthMetrics.svelte`: a row of 4 metric blocks — **Status · Last run · Runs (30d) · Success rate** — styled like the existing artifact "metric" blocks (border, label, value). Status shows a `StatusDot` (always expanded) + label. `lastRunAt` → relative time ("2h ago") or "—". `successRate` → `87%` or "—".

**Wiring**: detail `+page.server.ts` adds `health: await getHealthMetrics(ctx, agent)` to the returned data. `+page.svelte` renders `<AgentHealthMetrics {health} />` **between the header and the Overview/artifact section**.

## Phase 3 — Embedded view-only flow + EDIT gate (detail page)

- Detail page embeds `<MasterFlowCanvas flow={getMasterFlow(agent.flowId)} />` in a bordered panel (fixed height, e.g. `h-80`), labeled (e.g. "Flow"), placed after the metric blocks, before the artifact grid. Interactive view-only (pan/zoom; nodes non-draggable — existing behavior).
- **EDIT button** on the flow panel: rendered only when `data.isAdmin && agent.dbFlowId` (admin + DB-flow-backed). System agents have only a code `flowId` (no `dbFlowId`) → EDIT hidden (they stay view-only). Interim target: `href={/flow-editor/{dbFlowId}}`. Phase 4 will repoint EDIT to the flow-editor copilot chat.
- Add `dbFlowId?: string` to `AutonomousAgentVM` + `SystemAgentMeta` (the system metas leave it undefined). No behavior change for existing agents.

## Out of scope (Phase 4 — separate spec)
Flow-builder MCP (read/mutate DB `flows` rows) + flow-editor copilot system agent (chat, all-orgs, MCP-attached). EDIT repoints to it once built.

## Testing
- `getHealthMetrics`: unit test the three resolution branches (DB-flow via `flow_runs`, stats fallback, all-null) with a mocked db + VM fixtures.
- `StatusDot`: trivial render; covered by `bun run check`. No bespoke test.
- Manual: `bun run check` 0/0/0; eyeball card hover-expand + kebab + detail metrics + flow embed via `:5173` HMR.
