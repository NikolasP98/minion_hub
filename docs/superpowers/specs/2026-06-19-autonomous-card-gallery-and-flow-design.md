# Autonomous Card Artifact Gallery + Flow Association (Phase 1.5)

**Date:** 2026-06-19
**Status:** Approved design — ready for implementation plan
**Scope:** Enhance the autonomous-agent surface with (A) an **artifact gallery**
on each card — icon tiles with popover details + a stubbed admin-only **"add
artifact" (+)** tile — and (B) a **representative langchain/graph flow** per
autonomous agent, openable read-only in the graph editor. Refines the merged
artifact foundation (`2026-06-18-agent-artifacts-foundation-design.md`); the
triage migration (`2026-06-18-alert-watcher-triage-migration-design.md`) layers
on top (its triage artifact becomes a gallery tile).

## Decisions (confirmed)

- **"+" add-artifact:** present but **stubbed**, **admin-only** (the
  artifact-builder is a *system agent*, admin-managed not user-customizable —
  subsystem #5). The "+" opens a "coming soon" affordance now; wired to the
  builder when #5 lands.
- **Thumbnails:** **icon tiles with popover details** (not live mini-renders).
- **Flow:** every autonomous agent has an associated **representative** flow that
  is **true to its real functionality**, opened **read-only** in the existing
  graph editor.
- **Surface scope:** the gallery + flow link land on the **autonomous agent
  cards** (and detail page) now. **AI Brain** agents get the same gallery *when
  they gain a card surface* — brain agents currently render in the chat roster
  (no card), and the brain-archetype interface rework is out of scope here. The
  artifact/flow data model is agent-agnostic, so it generalizes for free later.

## Architecture

### A. Card artifact gallery

**Descriptor additions** (`src/lib/agents/artifacts.ts`): add `icon: string`
(lucide icon name) and `description: string` to `ArtifactDescriptor` (the
popover body). `overviewDescriptorFor` gets an icon (`LayoutDashboard`) +
description; future descriptors (triage) supply their own.

**Server load** (`src/routes/(app)/agents/autonomous/+page.server.ts`): in
addition to `systemAgents`, return:
- `artifactsByAgent: Record<string, ArtifactDescriptor[]>` — `getArtifactsForAgent(vm.id)` per agent.
- `isAdmin: boolean` — whether the user may add artifacts (gates the "+" tile).

**`ArtifactGallery.svelte`** (new, `src/lib/components/artifacts/`): renders the
footer gallery for a card:
- One **tile per artifact**: a square icon button (the artifact's lucide icon,
  token-themed) wrapped in the shared `Popover` (`$lib/components/ui`) whose
  content shows `title` + `description` + a small `kind` line. Clicking a tile
  **opens the artifact in a modal** (see below).
- An **"add artifact" (+)** tile, rendered only when `isAdmin`. It is **stubbed**:
  its popover/click shows a "Custom artifacts — coming soon (admin)" message; no
  builder call yet. A `// TODO: wire to artifact-builder system agent (#5)` marks
  the seam.
- Props: `{ artifacts: ArtifactDescriptor[]; canAdd: boolean; onOpen: (a) => void }`.

**Opening an artifact (modal):** clicking a tile opens the existing
`ArtifactHost` inside the shared `Modal` (`$lib/components/ui/Modal.svelte`), so
the user stays on the roster. `AutonomousAgentCard` owns the modal state
(`$state` selected descriptor) and renders `<Modal><ArtifactHost
descriptor={selected} /></Modal>` when one is selected. (The detail page keeps
its inline `ArtifactHost` for the full-page view.)

**Card layout** (`AutonomousAgentCard.svelte`, edit): below the existing footer
(stats + Manage), add the `ArtifactGallery` row. Manage still routes to the
detail page. Add a **"View flow"** affordance (see B).

### B. Flow association (representative, read-only)

Reuse the existing **master-flow read-only viewer** — no backend, no new route:
`/flow-editor/master/[id]` already renders a static `MasterFlow` from
`src/lib/flows/master-flows.ts` via `MasterFlowCanvas` (SvelteFlow, editing
disabled, pan/zoom).

- **`AGENT_FLOWS`** (new array in `src/lib/flows/master-flows.ts`): one
  `MasterFlow` per autonomous agent, hand-authored to depict the agent's *real*
  pipeline using the existing `MasterFlowNode`/`kind` vocabulary
  (`trigger`/`schedule`/`agent`/`llm`/`tool`/`router`/`channel`/`process`/`end`…).
  Phase 1.5 ships the **Reminders** flow (the only existing autonomous agent):
  `schedule (cron tick)` → `process (find due stages, 60d horizon)` →
  `llm (compose Spanish reminder)` → `channel (WhatsApp send)` →
  `process (mirror to messages ledger)` → `end`. (The Triage flow is added in
  the triage-migration phase, from its real `classify → route → alert/handoff`
  pipeline.)
- **`getMasterFlow(id)`** (edit): look up in `MASTER_FLOWS` **then**
  `AGENT_FLOWS`, so agent flows open via `/flow-editor/master/<id>` but do **not**
  clutter the `MasterFlowsSection` list (which iterates only `MASTER_FLOWS`).
- **Agent → flow id mapping:** add `flowId?: string` to the system-agent
  descriptor (e.g. Reminders → `'agent-reminders'`). Surfaced on the VM
  (`AutonomousAgentVM`) so the card/detail can build the link. Agents without a
  flow simply hide the action (none in phase 1.5; all should have one per the
  model).
- **"View flow" action:** on the card (and detail page), a small button/icon
  (`Workflow`/`GitBranch` lucide) → `goto('/flow-editor/master/' + flowId)` when
  `flowId` is set. Opens the representative flow read-only in the graph editor.

## Data flow

```
/agents/autonomous (load): systemAgents[] + artifactsByAgent + isAdmin
  → AutonomousAgentCard(agent, artifacts, isAdmin)
      ├─ ArtifactGallery: icon tiles (Popover details) + "+"(admin, stub)
      │     tile click → Modal(ArtifactHost descriptor)  [reuses live foundation]
      └─ "View flow" → /flow-editor/master/{agent.flowId}  → MasterFlowCanvas (read-only)
```

The artifact open path is unchanged from the foundation (ArtifactHost → gated
`hub.artifact.context.get`). The flow path is pure client navigation to the
existing read-only master viewer.

## Components & files

| File | Change |
|---|---|
| `src/lib/agents/artifacts.ts` | EDIT — add `icon` + `description` to `ArtifactDescriptor`; `overviewDescriptorFor` supplies them |
| `src/lib/agents/artifacts.test.ts` | EDIT — assert icon/description on the overview descriptor |
| `src/lib/agents/autonomous.ts` | EDIT — add `flowId?: string` to `AutonomousAgentVM` |
| `src/lib/server/system-agents/registry.ts` | EDIT — Reminders descriptor gets `flowId: 'agent-reminders'`; mapped onto the VM |
| `src/lib/flows/master-flows.ts` | EDIT — add `AGENT_FLOWS` (Reminders flow) + include it in `getMasterFlow` lookup (not in the listed `MASTER_FLOWS`) |
| `src/lib/components/artifacts/ArtifactGallery.svelte` | NEW — icon-tile gallery + popover + admin "+" stub |
| `src/lib/components/agents/AutonomousAgentCard.svelte` | EDIT — render gallery + artifact modal + "View flow" |
| `src/routes/(app)/agents/autonomous/+page.server.ts` | EDIT — return `artifactsByAgent` + `isAdmin` |
| `src/routes/(app)/agents/autonomous/+page.svelte` | EDIT — pass artifacts/isAdmin to cards |
| `src/routes/(app)/agents/autonomous/[id]/+page.svelte` | EDIT — add "View flow" link (consistency) |
| `messages/en.json`, `messages/es.json` | EDIT — gallery/add/view-flow/coming-soon strings |

## Out of scope (later)

- AI Brain card gallery (needs a brain card surface — brain interface rework).
- Wiring the "+" to the artifact-builder system agent (subsystem #5).
- Live/mini-render thumbnails; per-artifact custom icons beyond a lucide name.
- The Triage agent's flow + artifact (the triage-migration phase).
- Editable/runnable agent flows (these are representative + read-only).

## Testing

- `artifacts.ts`: unit-test that `overviewDescriptorFor` includes `icon` +
  `description`. (vitest)
- `master-flows.ts`: unit-test that `getMasterFlow('agent-reminders')` resolves
  the Reminders `AGENT_FLOWS` entry and that `agent-reminders` is **absent** from
  the listed `MASTER_FLOWS`. (vitest)
- Gallery/card/modal are presentational — verified by `bun run check` + Svelte
  autofixer + live; i18n parity en/es.

## Success criteria

- Each autonomous card shows a bottom **artifact gallery**: an icon tile per
  artifact (popover with title/description on hover) + an admin-only **"+"** tile
  (stub). Clicking a tile opens that artifact in a modal (themed, live data).
- Each autonomous card + detail page has a **"View flow"** action that opens the
  agent's representative flow read-only at `/flow-editor/master/<flowId>`; the
  Reminders flow accurately depicts its cron→due→compose→send→log pipeline.
- The agent flows do **not** appear in the `/flow-editor` master-flows list.
- `bun run check` clean; new vitest specs pass.
