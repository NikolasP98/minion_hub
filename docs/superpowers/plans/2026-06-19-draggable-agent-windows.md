# Draggable Agent Windows — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Open artifacts + agent flows as multiple, draggable, non-modal windows with a fullscreen toggle, replacing the single native-`<dialog>` artifact modal and the navigate-away "View flow".

**Architecture:** A page-local `$state` window manager + a reusable `DraggableDialog` (Zag non-modal dialog + custom title-bar drag) + an `AgentWindowLayer` mounted once via an autonomous-route layout. Card/detail open-artifact + View-flow call the manager.

**Tech Stack:** SvelteKit 2, Svelte 5 (runes), TypeScript, `@zag-js/svelte` + `@zag-js/dialog`, `@xyflow/svelte` (existing `MasterFlowCanvas`), Paraglide, Vitest, Bun. Hub, branch `dev`.

## Global Constraints

- Svelte 5 runes only; TS strict, no `any`; no `@ts-nocheck`.
- i18n in BOTH `messages/en.json` + `messages/es.json`; `bun run i18n:compile` before `bun run check`.
- `bun run check` 0/0; `bun run test` green. Commits UNSIGNED (`git -c commit.gpgsign=false`); never `git add` a lockfile **except** the deliberate `@zag-js/dialog` add in Task 2 (the `bun.lock` change there IS the feature).
- Validate every `.svelte` with the Svelte MCP autofixer before committing.
- No `Date.now()`/`Math.random()` in the store — use a module `seq` counter for z/cascade.

## Reference: verified shapes

- Zag Svelte-5 pattern (from `ui/Popover.svelte`): `import * as dialog from '@zag-js/dialog'; import { useMachine, normalizeProps } from '@zag-js/svelte';` → `const service = useMachine(dialog.machine, () => ({ id, ... }));` → `const api = $derived(dialog.connect(service, normalizeProps));` → spread `{...api.getPositionerProps()}`, `{...api.getContentProps()}`, `{...api.getTitleProps()}`, `{...api.getCloseTriggerProps()}`.
- `@zag-js/menu`/`@zag-js/popover` are at `^1.41.0`; `@zag-js/dialog` is NOT installed.
- `MasterFlowCanvas.svelte` prop: `{ flow: MasterFlow }`. `getMasterFlow(id)` from `$lib/flows/master-flows` resolves `MASTER_FLOWS ∪ AGENT_FLOWS`. SvelteFlow needs a **definite-height** ancestor.
- `ArtifactHost.svelte` prop: `{ descriptor: ArtifactDescriptor }`.
- `ArtifactDescriptor` (`$lib/agents/artifacts`): `{ id, agentId, slot, title, description, icon, kind, entrypoint }`.
- Card today: `AutonomousAgentCard.svelte` has `openArtifact = $state(...)` + a native `<Modal>` block + a "View flow" button `goto('/flow-editor/master/' + agent.flowId)`; gallery `onopen={(a) => (openArtifact = a)}`.
- Detail `[id]/+page.svelte`: "View flow" `<a href={`/flow-editor/master/${agent.flowId}`}>`.

---

### Task 1: Window-manager store

**Files:**
- Create: `src/lib/state/ui/agent-windows.svelte.ts`
- Test: `src/lib/state/ui/agent-windows.test.ts`

**Interfaces — Produces:** `agentWindows` (a `$state`-backed singleton) with `windows: AgentWindow[]` and methods `openArtifact(descriptor)`, `openFlow(flowId, title)`, `close(id)`, `focus(id)`, `toggleFullscreen(id)`, `setPosition(id, x, y)`. Types `AgentWindow`, `AgentWindowKind` exported.

- [ ] **Step 1: Write the failing test** — `src/lib/state/ui/agent-windows.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { agentWindows } from './agent-windows.svelte';
import type { ArtifactDescriptor } from '$lib/agents/artifacts';

const desc: ArtifactDescriptor = { id: 'overview', agentId: 'a1', slot: 'detail', title: 'Overview', description: 'd', icon: 'LayoutDashboard', kind: 'static', entrypoint: 'index.html' };

beforeEach(() => { for (const w of [...agentWindows.windows]) agentWindows.close(w.id); });

describe('agentWindows', () => {
  it('opens an artifact window', () => {
    agentWindows.openArtifact(desc);
    expect(agentWindows.windows).toHaveLength(1);
    expect(agentWindows.windows[0]).toMatchObject({ kind: 'artifact', id: 'artifact:a1:overview', title: 'Overview', fullscreen: false });
  });
  it('opening the same window focuses (no duplicate) and bumps z above others', () => {
    agentWindows.openArtifact(desc);
    agentWindows.openFlow('agent-reminders', 'Reminders');
    const firstZ = agentWindows.windows.find((w) => w.id === 'artifact:a1:overview')!.z;
    agentWindows.openArtifact(desc); // re-open → focus
    expect(agentWindows.windows).toHaveLength(2);
    const w = agentWindows.windows.find((x) => x.id === 'artifact:a1:overview')!;
    expect(w.z).toBeGreaterThan(firstZ);
    expect(w.z).toBeGreaterThan(agentWindows.windows.find((x) => x.kind === 'flow')!.z);
  });
  it('opens a flow window', () => {
    agentWindows.openFlow('agent-reminders', 'Reminders');
    expect(agentWindows.windows[0]).toMatchObject({ kind: 'flow', id: 'flow:agent-reminders', flowId: 'agent-reminders', title: 'Reminders' });
  });
  it('toggleFullscreen flips the flag; close removes; setPosition updates', () => {
    agentWindows.openFlow('f1', 'F1');
    const id = 'flow:f1';
    agentWindows.toggleFullscreen(id);
    expect(agentWindows.windows[0].fullscreen).toBe(true);
    agentWindows.setPosition(id, 42, 24);
    expect(agentWindows.windows[0]).toMatchObject({ x: 42, y: 24 });
    agentWindows.close(id);
    expect(agentWindows.windows).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run red** — `bun run test -- src/lib/state/ui/agent-windows.test.ts` → FAIL (module missing).

- [ ] **Step 3: Implement** — `src/lib/state/ui/agent-windows.svelte.ts`:

```ts
import type { ArtifactDescriptor } from '$lib/agents/artifacts';

export type AgentWindowKind = 'artifact' | 'flow';

export interface AgentWindow {
  id: string;
  kind: AgentWindowKind;
  title: string;
  artifact?: ArtifactDescriptor;
  flowId?: string;
  fullscreen: boolean;
  z: number;
  x: number;
  y: number;
}

let seq = 0; // drives z-order + cascade offset; avoids Date.now()/random

function makeWindowStore() {
  const windows = $state<AgentWindow[]>([]);
  const find = (id: string) => windows.find((w) => w.id === id);

  function add(base: Omit<AgentWindow, 'fullscreen' | 'z' | 'x' | 'y'>): void {
    const existing = find(base.id);
    if (existing) {
      focus(base.id);
      return;
    }
    seq += 1;
    const offset = (windows.length % 6) * 28; // cascade
    windows.push({ ...base, fullscreen: false, z: seq, x: 80 + offset, y: 80 + offset });
  }
  function focus(id: string): void {
    const w = find(id);
    if (!w) return;
    seq += 1;
    w.z = seq;
  }
  function close(id: string): void {
    const i = windows.findIndex((w) => w.id === id);
    if (i >= 0) windows.splice(i, 1);
  }
  function toggleFullscreen(id: string): void {
    const w = find(id);
    if (w) w.fullscreen = !w.fullscreen;
    focus(id);
  }
  function setPosition(id: string, x: number, y: number): void {
    const w = find(id);
    if (w) { w.x = x; w.y = y; }
  }
  return {
    get windows() { return windows; },
    openArtifact(descriptor: ArtifactDescriptor) {
      add({ id: `artifact:${descriptor.agentId}:${descriptor.id}`, kind: 'artifact', title: descriptor.title, artifact: descriptor });
    },
    openFlow(flowId: string, title: string) {
      add({ id: `flow:${flowId}`, kind: 'flow', title, flowId });
    },
    close, focus, toggleFullscreen, setPosition,
  };
}

export const agentWindows = makeWindowStore();
```

- [ ] **Step 4: Run green** — `bun run test -- src/lib/state/ui/agent-windows.test.ts` → PASS. `bun run check` → 0.

- [ ] **Step 5: Commit**
```bash
git add src/lib/state/ui/agent-windows.svelte.ts src/lib/state/ui/agent-windows.test.ts
git -c commit.gpgsign=false commit -m "feat(windows): agent-windows store (multi-instance, z-order, fullscreen)"
```

---

### Task 2: `DraggableDialog` (Zag non-modal + drag)

**Files:**
- Modify: `package.json` (add `@zag-js/dialog`)
- Create: `src/lib/components/ui/DraggableDialog.svelte`
- Modify: `src/lib/components/ui/index.ts` (export)
- Modify: `messages/en.json`, `messages/es.json` (control labels)

**Interfaces — Produces:** `<DraggableDialog title z fullscreen x y onfocus onclose ontogglefullscreen onmove>{children}</DraggableDialog>`.

- [ ] **Step 1: Add the dep** — `bun add @zag-js/dialog@^1.41.0` (matches the `@zag-js/menu`/`popover` major). Confirm `node_modules/@zag-js/dialog` now resolves.

- [ ] **Step 2: i18n** — `messages/en.json`: `"window_fullscreen": "Fullscreen",` `"window_restore": "Restore",` `"window_close": "Close",`. `messages/es.json`: `"window_fullscreen": "Pantalla completa",` `"window_restore": "Restaurar",` `"window_close": "Cerrar",`.

- [ ] **Step 3: Write the component** — `src/lib/components/ui/DraggableDialog.svelte`:

```svelte
<script lang="ts">
  import type { Snippet } from 'svelte';
  import * as dialog from '@zag-js/dialog';
  import { useMachine, normalizeProps } from '@zag-js/svelte';
  import { Maximize2, Minimize2, X } from 'lucide-svelte';
  import * as m from '$lib/paraglide/messages';

  let {
    title,
    z,
    fullscreen,
    x,
    y,
    onfocus,
    onclose,
    ontogglefullscreen,
    onmove,
    children,
  }: {
    title: string;
    z: number;
    fullscreen: boolean;
    x: number;
    y: number;
    onfocus: () => void;
    onclose: () => void;
    ontogglefullscreen: () => void;
    onmove: (x: number, y: number) => void;
    children: Snippet;
  } = $props();

  let nextId = 0;
  const dialogId = `agent-window-${nextId++}`;
  // Non-modal: multiple coexist, background interactive, no scroll-block; we own
  // positioning + drag, Zag handles open/escape/aria.
  const service = useMachine(dialog.machine, () => ({
    id: dialogId,
    modal: false,
    closeOnInteractOutside: false,
    preventScroll: false,
    closeOnEscape: true,
    open: true,
    onOpenChange({ open }: { open: boolean }) {
      if (!open) onclose();
    },
  }));
  const api = $derived(dialog.connect(service, normalizeProps));

  // ── Drag (title bar) ────────────────────────────────────────────────────
  let dragging = false;
  let startX = 0, startY = 0, originX = 0, originY = 0;

  function onPointerDown(e: PointerEvent) {
    if (fullscreen) return;
    dragging = true;
    startX = e.clientX; startY = e.clientY; originX = x; originY = y;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }
  function onPointerMove(e: PointerEvent) {
    if (!dragging) return;
    const nx = Math.max(0, Math.min(window.innerWidth - 80, originX + (e.clientX - startX)));
    const ny = Math.max(0, Math.min(window.innerHeight - 40, originY + (e.clientY - startY)));
    onmove(nx, ny);
  }
  function onPointerUp(e: PointerEvent) {
    dragging = false;
    try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId); } catch { /* ignore */ }
  }

  const frameStyle = $derived(
    fullscreen
      ? `position:fixed;inset:0;z-index:${z};`
      : `position:fixed;left:${x}px;top:${y}px;z-index:${z};width:min(760px,92vw);height:min(580px,82vh);`,
  );
</script>

<div {...api.getPositionerProps()} style={frameStyle} onpointerdowncapture={() => onfocus()}>
  <!-- Mirror ui/Modal.svelte's look: surface-4 + radius-xl + hairline borders +
       t-heading title + the same close-button styling (the dialog in the
       reference screenshot). Body is padless so the artifact iframe / flow
       canvas fills edge-to-edge. -->
  <div
    {...api.getContentProps()}
    class="surface-4 flex h-full w-full flex-col overflow-hidden text-foreground shadow-2xl outline-none {fullscreen ? 'rounded-none' : 'rounded-[var(--radius-xl)]'}"
  >
    <!-- title bar / drag handle -->
    <header
      onpointerdown={onPointerDown}
      onpointermove={onPointerMove}
      onpointerup={onPointerUp}
      class="flex shrink-0 items-center gap-3 border-b border-[var(--hairline)] px-5 py-3.5 {fullscreen ? '' : 'cursor-move'} select-none"
    >
      <h2 {...api.getTitleProps()} class="t-heading min-w-0 flex-1 truncate">{title}</h2>
      <button
        type="button"
        onpointerdown={(e) => e.stopPropagation()}
        onclick={() => ontogglefullscreen()}
        aria-label={fullscreen ? m.window_restore() : m.window_fullscreen()}
        class="flex h-7 w-7 items-center justify-center rounded-[var(--radius-md)] text-muted-foreground transition-colors duration-[150ms] hover:bg-white/[0.06] hover:text-foreground"
      >
        {#if fullscreen}<Minimize2 size={14} />{:else}<Maximize2 size={14} />{/if}
      </button>
      <button
        type="button"
        {...api.getCloseTriggerProps()}
        onpointerdown={(e) => e.stopPropagation()}
        aria-label={m.window_close()}
        class="-mr-1 flex h-7 w-7 items-center justify-center rounded-[var(--radius-md)] text-muted-foreground transition-colors duration-[150ms] hover:bg-white/[0.06] hover:text-foreground"
      >
        <X size={16} />
      </button>
    </header>
    <div class="min-h-0 flex-1 overflow-hidden">
      {@render children()}
    </div>
  </div>
</div>
```

> Notes for the implementer: Zag's positioner normally centers the dialog; we override with `frameStyle` (fixed left/top or inset:0) so it's draggable/fullscreen. `getCloseTriggerProps()` drives close → `onOpenChange(false)` → `onclose`. The autofixer may suggest tweaks to event-handler typing — apply correctness fixes, keep the drag + stop-propagation on the buttons. Verify the real `@zag-js/dialog` connect part names (`getPositionerProps`/`getContentProps`/`getTitleProps`/`getCloseTriggerProps`) against the installed package; adjust if the API differs.

- [ ] **Step 4: Export** — in `src/lib/components/ui/index.ts` add: `export { default as DraggableDialog } from './DraggableDialog.svelte';`

- [ ] **Step 5: Validate + check** — Svelte MCP autofixer on the component (apply correctness fixes; confirm the Zag dialog connect API). `bun run i18n:compile && bun run check` → 0.

- [ ] **Step 6: Commit**
```bash
git add package.json bun.lock src/lib/components/ui/DraggableDialog.svelte src/lib/components/ui/index.ts messages/en.json messages/es.json
git -c commit.gpgsign=false commit -m "feat(windows): DraggableDialog (Zag non-modal + title-bar drag + fullscreen)"
```

---

### Task 3: `AgentWindowLayer` + autonomous layout mount

**Files:**
- Create: `src/lib/components/agents/AgentWindowLayer.svelte`
- Create: `src/routes/(app)/agents/autonomous/+layout.svelte`

**Interfaces:** `AgentWindowLayer` renders all `agentWindows.windows` as `DraggableDialog`s; the layout mounts it once + renders children.

- [ ] **Step 1: Write the layer** — `src/lib/components/agents/AgentWindowLayer.svelte`:

```svelte
<script lang="ts">
  import { agentWindows } from '$lib/state/ui/agent-windows.svelte';
  import { DraggableDialog } from '$lib/components/ui';
  import ArtifactHost from '$lib/components/artifacts/ArtifactHost.svelte';
  import MasterFlowCanvas from '$lib/components/flow-editor/MasterFlowCanvas.svelte';
  import { getMasterFlow } from '$lib/flows/master-flows';
  import { BookOpen } from 'lucide-svelte';
  import * as m from '$lib/paraglide/messages';
</script>

{#each agentWindows.windows as w (w.id)}
  <DraggableDialog
    title={w.title}
    z={w.z}
    fullscreen={w.fullscreen}
    x={w.x}
    y={w.y}
    onfocus={() => agentWindows.focus(w.id)}
    onclose={() => agentWindows.close(w.id)}
    ontogglefullscreen={() => agentWindows.toggleFullscreen(w.id)}
    onmove={(x, y) => agentWindows.setPosition(w.id, x, y)}
  >
    {#if w.kind === 'artifact' && w.artifact}
      <ArtifactHost descriptor={w.artifact} />
    {:else if w.kind === 'flow' && w.flowId}
      {@const flow = getMasterFlow(w.flowId)}
      {#if flow}
        <div class="flex h-full flex-col">
          {#if w.fullscreen}
            <div class="flex shrink-0 items-center gap-2 border-b border-white/10 px-3 py-1.5 text-[11px] text-white/50">
              <BookOpen size={12} /> {m.misc_masterFlowReadOnly()}
            </div>
          {/if}
          <div class="min-h-0 flex-1">
            <MasterFlowCanvas {flow} />
          </div>
        </div>
      {:else}
        <div class="grid h-full place-items-center text-sm text-white/40">{m.flow_masterFlowLabel()}</div>
      {/if}
    {/if}
  </DraggableDialog>
{/each}
```

(`m.misc_masterFlowReadOnly` + `m.flow_masterFlowLabel` already exist — used by the master viewer page.)

- [ ] **Step 2: Mount via layout** — `src/routes/(app)/agents/autonomous/+layout.svelte`:

```svelte
<script lang="ts">
  import type { Snippet } from 'svelte';
  import AgentWindowLayer from '$lib/components/agents/AgentWindowLayer.svelte';
  let { children }: { children: Snippet } = $props();
</script>

{@render children()}
<AgentWindowLayer />
```

- [ ] **Step 3: Validate + check** — Svelte autofixer on both; `bun run check` → 0. (SvelteFlow needs definite height — the flow body's `min-h-0 flex-1` inside the dialog's fixed/inset frame provides it; verify the canvas renders with height in the live check.)

- [ ] **Step 4: Commit**
```bash
git add src/lib/components/agents/AgentWindowLayer.svelte "src/routes/(app)/agents/autonomous/+layout.svelte"
git -c commit.gpgsign=false commit -m "feat(windows): AgentWindowLayer + autonomous layout mount"
```

---

### Task 4: Rewire card + detail to the window manager

**Files:**
- Modify: `src/lib/components/agents/AutonomousAgentCard.svelte`
- Modify: `src/routes/(app)/agents/autonomous/[id]/+page.svelte`

- [ ] **Step 1: Card** — in `AutonomousAgentCard.svelte`:
  - Remove the `import { Modal }`, the `import ArtifactHost`, the `openArtifact = $state(...)`, and the entire `{#if openArtifact}<Modal>…</Modal>{/if}` block.
  - Add `import { agentWindows } from '$lib/state/ui/agent-windows.svelte';`.
  - Gallery: `onopen={(a) => agentWindows.openArtifact(a)}`.
  - "View flow" button: replace `onclick={() => goto(`/flow-editor/master/${agent.flowId}`)}` with `onclick={() => agentWindows.openFlow(agent.flowId!, agent.name)}` (keep the `{#if agent.flowId}` guard; `goto` import may become unused — remove it only if no other usage remains, otherwise leave).

- [ ] **Step 2: Detail page** — in `[id]/+page.svelte`, replace the "View flow" `<a href={`/flow-editor/master/${agent.flowId}`}>…</a>` with a `<button type="button" onclick={() => agentWindows.openFlow(agent.flowId!, agent.name)}>` (same classes/icon/label); add the `agentWindows` import. Artifact tiles there (if present) → `openArtifact`.

- [ ] **Step 3: Validate + check** — Svelte autofixer on both; `bun run check` → 0 (fix any now-unused import).

- [ ] **Step 4: Commit**
```bash
git add src/lib/components/agents/AutonomousAgentCard.svelte "src/routes/(app)/agents/autonomous/[id]/+page.svelte"
git -c commit.gpgsign=false commit -m "feat(windows): open artifacts + flows as draggable windows from card/detail"
```

---

### Task 5: Full verification

- [ ] **Step 1:** `bun run i18n:compile && bun run check` → 0 errors / 0 warnings.
- [ ] **Step 2:** `bun run test` → green; `agent-windows.test.ts` passes; pre-existing `aci-backend.test.ts` git-env flake (if it appears) is unrelated — confirm no NEW failures.
- [ ] **Step 3: Live (best-effort)** — if a DB-connected dev instance is available: on `/agents/autonomous`, click an artifact tile → it opens in a draggable window; open a second artifact + a flow → all coexist, draggable by title bars, background interactive; fullscreen toggle maximizes/restores; "View flow" shows the interactive pan/zoom canvas, fullscreen shows the read-only viewer chrome; re-opening focuses the existing window. If no instance, note deferred.
- [ ] **Step 4:** Commit any fixes.

---

## Self-Review

**Spec coverage:** window manager (T1) ✓; DraggableDialog Zag-non-modal + drag + fullscreen + z (T2) ✓; `@zag-js/dialog` dep (T2) ✓; AgentWindowLayer + once-mounted layout (T3) ✓; artifact→ArtifactHost, flow→MasterFlowCanvas windowed + read-only-viewer fullscreen (T3) ✓; rewire card + detail, drop native Modal for artifacts (T4) ✓; multi-open + focus-dedupe + fullscreen (T1 store + live) ✓; i18n en/es (T2) ✓; store unit tests (T1) ✓. Out-of-scope (editable builder, persistence, brain windows, builder "+") absent.

**Placeholder scan:** none — complete code/commands. The "verify Zag connect part names against the installed package" note in T2 is a real validation step (the package isn't installed yet), not a placeholder.

**Type consistency:** `AgentWindow`/`agentWindows` API (T1) consumed by `AgentWindowLayer` (T3) + card/detail (T4) with matching method names (`openArtifact`/`openFlow`/`focus`/`close`/`toggleFullscreen`/`setPosition`). `DraggableDialog` prop names (T2) match the layer's usage (T3). `MasterFlowCanvas {flow}` + `getMasterFlow` + `ArtifactHost {descriptor}` per their real signatures. Window `id` scheme (`artifact:agentId:id`, `flow:flowId`) is consistent between store + tests.
