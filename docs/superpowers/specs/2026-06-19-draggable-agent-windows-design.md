# Draggable Agent Windows (artifacts + flows in multi-instance Zag dialogs)

**Date:** 2026-06-19
**Status:** Approved design — ready for implementation plan
**Scope:** Replace the single native-`<dialog>` artifact modal + the navigate-away
"View flow" with a **multi-instance, draggable, non-modal window system**.
Artifacts and agent flows open as draggable windows; the user can open several at
once; each has a **fullscreen toggle**. A flow window shows an interactive
(pan/zoom) read-only canvas; fullscreen shows the full read-only flow viewer.

## Context (verified)

- Today, the autonomous card opens an artifact in `ui/Modal.svelte` — a **native
  `<dialog>` `showModal()`** (modal, focus-trapped, single top-layer; can't
  show two at once). "View flow" (card + detail) `goto('/flow-editor/master/<flowId>')`
  — navigates away.
- Zag is the repo's headless-UI lib (`@zag-js/svelte`; Dropdown/Popover/Tooltip/
  Combobox). Zag **dialog** supports **non-modal** (`modal: false` → multiple
  coexist, no focus-trap/scroll-block, background interactive) with
  `closeOnInteractOutside: false`, `preventScroll: false`. **Dragging is not
  built in** — added via pointer events on the title bar.
- `MasterFlowCanvas.svelte` takes `{ flow: MasterFlow }` and renders a read-only
  SvelteFlow (`@xyflow/svelte`) pan/zoom canvas. `getMasterFlow(id)` resolves
  `MASTER_FLOWS ∪ AGENT_FLOWS`. The master viewer page
  (`/flow-editor/master/[id]`) is a flex-column shell: a toolbar (name +
  read-only pill) + `MasterFlowCanvas`.
- Agent flows are **representative read-only** `MasterFlow`s — there is no
  editable builder for them; "full builder UI" for an agent flow therefore means
  the **full read-only viewer chrome** (toolbar + canvas), not an editor.

## Decisions (confirmed)

- **Both artifacts + flows** in this feature (shared window system).
- **Fullscreen agent-flow = the full read-only viewer chrome** (toolbar + canvas);
  windowed = just the interactive pan/zoom canvas. (Editable-builder fullscreen
  is out of scope — applies only if real editable flows adopt this later.)
- **Page-local, in-memory windows** (close on navigate-away/refresh). Cross-reload
  persistence is deferred (YAGNI).
- **Zag non-modal dialog + custom title-bar drag** (no new windowing dependency;
  reuses the established `@zag-js/svelte` pattern). May add the `@zag-js/dialog`
  package if not already installed.

## Architecture

### 1. Window manager — `src/lib/state/ui/agent-windows.svelte.ts`

A `$state` store of open windows (page-local):

```ts
export type AgentWindowKind = 'artifact' | 'flow';
export interface AgentWindow {
  id: string;                 // dedupe key: `${kind}:${refId}` (artifact descriptor id+agentId, or flowId)
  kind: AgentWindowKind;
  title: string;
  artifact?: ArtifactDescriptor;  // when kind==='artifact'
  flowId?: string;                // when kind==='flow'
  fullscreen: boolean;
  z: number;                  // stacking order
  // initial position offset so stacked windows cascade
  x: number; y: number;
}
```
API (pure-ish state ops, unit-testable): `openArtifact(descriptor)`, `openFlow(flowId, title)`, `close(id)`, `focus(id)` (bump `z` to max+1), `toggleFullscreen(id)`, `setPosition(id, x, y)`. Opening an already-open `id` focuses it instead of duplicating. A module-level `seq` counter drives `z` and cascade offsets. (No `Date.now()`/random — use the counter.)

### 2. `src/lib/components/ui/DraggableDialog.svelte`

A reusable non-modal draggable dialog (exported from the `ui` barrel):
- Wraps `@zag-js/dialog` `useMachine(dialog.machine, { id, modal: false, closeOnInteractOutside: false, preventScroll: false, closeOnEscape: true, onOpenChange })`, `api = $derived(dialog.connect(...))`. Rendered open (controlled).
- Props: `{ title: string; z: number; fullscreen: boolean; x: number; y: number; onfocus: () => void; onclose: () => void; ontogglefullscreen: () => void; onmove: (x, y) => void; children: Snippet }`.
- **Positioner**: when not fullscreen, absolutely positioned at `(x, y)` with a sensible default size (e.g. `min(720px, 90vw) × min(560px, 80vh)`), `z-index: z`; when fullscreen, `inset: 0` filling the viewport. `pointerdown` anywhere calls `onfocus` (z-bump).
- **Title bar** = drag handle: a header with the title + a **fullscreen/restore** button (`Maximize2`/`Minimize2`) + a **close** button (`X`). Pointer-drag on the header moves the window (`pointermove` → `onmove(clampedX, clampedY)`, clamped to viewport); disabled while fullscreen. Buttons stop-propagation so they don't start a drag.
- Body renders `children` (fills remaining height, `min-h-0`, scroll/own-canvas as needed).
- Design-token styled (border/bg/radius via CSS vars), matching the existing Modal's look.

### 3. `src/lib/components/agents/AgentWindowLayer.svelte`

Rendered **once** on the autonomous surface (mounted in a new
`src/routes/(app)/agents/autonomous/+layout.svelte` that renders
`{@render children()}` + `<AgentWindowLayer />`, covering both the roster and the
`[id]` detail page). Iterates `agentWindows.windows` and renders a
`DraggableDialog` per window, wiring its callbacks to the manager, with content by kind:
- **artifact** → `<ArtifactHost descriptor={w.artifact} />` (fills the window; fullscreen just maximizes).
- **flow** (windowed) → `<MasterFlowCanvas flow={getMasterFlow(w.flowId)} />` (interactive pan/zoom). **flow (fullscreen)** → the same `MasterFlowCanvas` plus the viewer chrome (name + read-only pill toolbar) — i.e. the full read-only viewer, in-place (no navigation). A missing/unknown flow renders an empty-state.

### 4. Rewiring

- `AutonomousAgentCard.svelte`: remove the native `Modal` + `openArtifact` state; the gallery's `onopen` calls `agentWindows.openArtifact(descriptor)`; "View flow" button calls `agentWindows.openFlow(agent.flowId, agent.name)` instead of `goto(...)`.
- `/agents/autonomous/[id]/+page.svelte`: "View flow" link → `agentWindows.openFlow(...)`; artifact tiles (if shown there) → `openArtifact`.
- The `ui/Modal.svelte` component stays (other callers use it) — only the artifact usage moves to the window system.

## Components & files

| File | Change |
|---|---|
| `src/lib/state/ui/agent-windows.svelte.ts` | NEW — window-manager store |
| `src/lib/state/ui/agent-windows.test.ts` | NEW — unit tests for open/close/focus/fullscreen/dedupe ordering |
| `src/lib/components/ui/DraggableDialog.svelte` | NEW — Zag non-modal dialog + drag + fullscreen + z |
| `src/lib/components/ui/index.ts` | EDIT — export `DraggableDialog` |
| `src/lib/components/agents/AgentWindowLayer.svelte` | NEW — renders open windows (artifact / flow / fullscreen-flow) |
| `src/routes/(app)/agents/autonomous/+layout.svelte` | NEW — renders children + mounts `AgentWindowLayer` once |
| `src/lib/components/agents/AutonomousAgentCard.svelte` | EDIT — gallery open + View-flow → `agentWindows`; drop native Modal usage |
| `src/routes/(app)/agents/autonomous/[id]/+page.svelte` | EDIT — View-flow → `agentWindows.openFlow` |
| `messages/en.json`, `messages/es.json` | EDIT — window control labels (fullscreen / restore / close) |
| `package.json` | EDIT (if needed) — add `@zag-js/dialog` if not already a dependency |

## Out of scope (later)

- Editable-builder fullscreen for flows (agent flows are read-only); real
  editable flows adopting this system.
- Cross-reload window persistence (localStorage), resize handles, window
  snapping/tiling, minimize-to-taskbar.
- Brain-agent windows (no brain card surface yet).
- Artifact windows for the `+`/builder (subsystem #5, not built).

## Testing

- `agent-windows.test.ts` (pure store): open creates a window; opening the same
  `id` focuses (no duplicate); `focus` bumps `z` above others; `toggleFullscreen`
  flips the flag; `close` removes; cascade offsets increment. (vitest, no DOM.)
- `DraggableDialog`/`AgentWindowLayer` are presentational/integration — verified
  by `bun run check` + Svelte autofixer + live (drag, multi-open, fullscreen).
- i18n parity en/es.

## Success criteria

- Clicking an artifact tile opens it in a **draggable** window; opening another
  (or a flow) keeps the first open — **multiple windows coexist**, draggable by
  their title bars, background stays interactive.
- Each window has a **fullscreen toggle**; fullscreen fills the viewport, restore
  returns it to its position.
- "View flow" opens the agent's flow as an **interactive pan/zoom canvas** in a
  window; **fullscreen** shows the full read-only viewer (toolbar + canvas) —
  no navigation away from `/agents/autonomous`.
- Re-opening an already-open artifact/flow focuses the existing window.
- `bun run check` clean; the store unit tests pass.
