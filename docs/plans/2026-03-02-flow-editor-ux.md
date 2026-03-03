# Flow Editor UX Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix node position stacking bug, add drag-to-create from sidebar, show icons in collapsed sidebar, and add a structured console log panel for test runs.

**Architecture:** All changes are isolated to the flow-editor component tree (`src/lib/components/flow-editor/`) and the flow editor page (`src/routes/flow-editor/[id]/+page.svelte`). Log state is added to the existing `flowEditorState` in `flow-editor.svelte.ts`. No backend changes required.

**Tech Stack:** Svelte 5 runes, @xyflow/svelte v1, Tailwind CSS, lucide-svelte

---

### Task 1: Fix node position stacking bug

**Files:**
- Modify: `src/lib/components/flow-editor/FlowCanvas.svelte`

The root cause: `onnodeschange` calls `setNodes()` unconditionally, including for `select` and `dimensions` events. More critically, it applies `position` changes fired during initialization (fitView, initial layout) which have intermediate/incorrect coordinates. Those get saved to the localStorage draft, corrupting positions on next load.

Fix: only update positions when `change.dragging === false` (drag-end), and only call `setNodes` when there were actual relevant changes.

**Step 1: Replace the `onnodeschange` handler in `FlowCanvas.svelte`**

Find the existing handler (lines 78-92):
```svelte
onnodeschange={(changes) => {
  // Apply position changes reactively
  const updated = [...flowEditorState.nodes];
  for (const change of changes) {
    if (change.type === 'position' && change.position) {
      const idx = updated.findIndex((n) => n.id === change.id);
      if (idx !== -1) updated[idx] = { ...updated[idx], position: change.position };
    }
    if (change.type === 'remove') {
      const idx = updated.findIndex((n) => n.id === change.id);
      if (idx !== -1) updated.splice(idx, 1);
    }
  }
  setNodes(updated);
}}
```

Replace with:
```svelte
onnodeschange={(changes) => {
  let dirty = false;
  const updated = [...flowEditorState.nodes];
  for (const change of changes) {
    if (change.type === 'position' && change.dragging === false && change.position) {
      // Only persist on drag-end, not during drag or @xyflow initialization
      const idx = updated.findIndex((n) => n.id === change.id);
      if (idx !== -1) {
        updated[idx] = { ...updated[idx], position: change.position };
        dirty = true;
      }
    }
    if (change.type === 'remove') {
      const idx = updated.findIndex((n) => n.id === change.id);
      if (idx !== -1) {
        updated.splice(idx, 1);
        dirty = true;
      }
    }
  }
  if (dirty) setNodes(updated);
}}
```

**Step 2: Verify fix manually**
1. Open the flow editor with existing nodes
2. Refresh the page — nodes should appear at their saved positions, not stacked
3. Add a new node — it should appear at the random offset position, not stack with others
4. Drag a node to a new position, save, refresh — position should be preserved

**Step 3: Commit**
```bash
git add src/lib/components/flow-editor/FlowCanvas.svelte
git commit -m "fix(flow-editor): only persist node positions on drag-end to prevent stacking bug"
```

---

### Task 2: Add log state to flow-editor state

**Files:**
- Modify: `src/lib/state/flow-editor.svelte.ts`

Add `LogEntry` type, log state fields, and helper functions.

**Step 1: Add `LogEntry` type after the existing types (after line 40)**
```ts
export type LogEntry = {
  id: string;
  timestamp: number;
  level: 'info' | 'warn' | 'error' | 'debug';
  message: string;
  nodeId?: string;
};
```

**Step 2: Add log fields to `flowEditorState` (inside the `$state({...})` object)**
```ts
consoleOpen: false,
consoleLogs: [] as LogEntry[],
```

**Step 3: Add `appendLog` and `clearLogs` exports after `setRelationshipMode`**
```ts
export function appendLog(entry: Omit<LogEntry, 'id' | 'timestamp'>) {
  flowEditorState.consoleLogs.push({
    ...entry,
    id: `log-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
    timestamp: Date.now(),
  });
}

export function clearLogs() {
  flowEditorState.consoleLogs = [];
}
```

**Step 4: Commit**
```bash
git add src/lib/state/flow-editor.svelte.ts
git commit -m "feat(flow-editor): add log entry state and helpers for console panel"
```

---

### Task 3: Create ConsolePanel component

**Files:**
- Create: `src/lib/components/flow-editor/ConsolePanel.svelte`

**Step 1: Create the component**
```svelte
<script lang="ts">
  import { flowEditorState, clearLogs } from '$lib/state/flow-editor.svelte';
  import { X, Trash2 } from 'lucide-svelte';

  let logContainer = $state<HTMLDivElement | null>(null);

  // Auto-scroll to bottom when new logs arrive
  $effect(() => {
    const _ = flowEditorState.consoleLogs.length;
    if (logContainer) {
      logContainer.scrollTop = logContainer.scrollHeight;
    }
  });

  const levelClass: Record<string, string> = {
    info: 'text-blue-400',
    warn: 'text-amber-400',
    error: 'text-red-400',
    debug: 'text-muted/60',
  };

  function formatTime(ts: number) {
    return new Date(ts).toLocaleTimeString(undefined, {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
  }
</script>

<div class="shrink-0 h-44 border-t border-border bg-bg flex flex-col overflow-hidden">
  <!-- Header -->
  <div class="flex items-center justify-between px-3 py-1.5 border-b border-border bg-bg2 shrink-0">
    <div class="flex items-center gap-2">
      <span class="text-[10px] font-semibold text-muted uppercase tracking-widest font-mono">Console</span>
      {#if flowEditorState.consoleLogs.length > 0}
        <span class="text-[9px] font-mono text-muted/50 bg-bg3 px-1.5 py-0.5 rounded">
          {flowEditorState.consoleLogs.length}
        </span>
      {/if}
    </div>
    <div class="flex items-center gap-1">
      <button
        onclick={clearLogs}
        class="flex items-center justify-center w-5 h-5 rounded text-muted/60 hover:text-foreground hover:bg-bg3 transition-colors"
        title="Clear logs"
      >
        <Trash2 size={11} />
      </button>
      <button
        onclick={() => (flowEditorState.consoleOpen = false)}
        class="flex items-center justify-center w-5 h-5 rounded text-muted/60 hover:text-foreground hover:bg-bg3 transition-colors"
        title="Close console"
      >
        <X size={11} />
      </button>
    </div>
  </div>

  <!-- Log lines -->
  <div
    bind:this={logContainer}
    class="flex-1 overflow-y-auto px-3 py-2 space-y-0.5 font-mono"
  >
    {#if flowEditorState.consoleLogs.length === 0}
      <p class="text-[11px] text-muted/40 italic">No output yet.</p>
    {:else}
      {#each flowEditorState.consoleLogs as entry (entry.id)}
        <div class="flex items-start gap-2 text-[11px] leading-5">
          <span class="text-muted/40 shrink-0 select-none">{formatTime(entry.timestamp)}</span>
          <span class="shrink-0 select-none {levelClass[entry.level] ?? 'text-foreground'} uppercase w-10">
            [{entry.level.slice(0, 4)}]
          </span>
          {#if entry.nodeId}
            <span class="shrink-0 text-accent/70 bg-accent/10 px-1 rounded text-[10px]">{entry.nodeId}</span>
          {/if}
          <span class="text-foreground/80 break-all">{entry.message}</span>
        </div>
      {/each}
    {/if}
  </div>
</div>
```

**Step 2: Commit**
```bash
git add src/lib/components/flow-editor/ConsolePanel.svelte
git commit -m "feat(flow-editor): add ConsolePanel component with structured log output"
```

---

### Task 4: Wire ConsolePanel into the page and update Test Run

**Files:**
- Modify: `src/routes/flow-editor/[id]/+page.svelte`

**Step 1: Add imports at the top of the `<script>` block**
```ts
import ConsolePanel from '$lib/components/flow-editor/ConsolePanel.svelte';
import { appendLog, clearLogs } from '$lib/state/flow-editor.svelte';
```

**Step 2: Replace `handleTestRun` with a version that populates the console**
```ts
async function handleTestRun() {
  isRunning = true;
  clearLogs();
  flowEditorState.consoleOpen = true;

  appendLog({ level: 'info', message: 'Starting flow test run…' });

  // Simulate phased execution output
  const steps = [
    { delay: 300, level: 'debug' as const, message: 'Resolving node execution order' },
    { delay: 600, level: 'info' as const, message: `Processing ${flowEditorState.nodes.length} node(s)` },
    { delay: 1000, level: 'info' as const, message: 'Executing prompt box inputs' },
    { delay: 1400, level: 'info' as const, message: 'Dispatching to agents' },
    { delay: 1800, level: 'info' as const, message: 'Flow run complete.' },
  ];

  for (const step of steps) {
    await new Promise<void>((resolve) => setTimeout(resolve, step.delay));
    appendLog({ level: step.level, message: step.message });
  }

  isRunning = false;
}
```

**Step 3: Add `ConsolePanel` to the layout**

Find the editor body div:
```svelte
<!-- Editor body -->
<div class="flex flex-1 min-h-0 overflow-hidden">
  <FlowSidebar />
  <FlowCanvas />
</div>
```

Replace with:
```svelte
<!-- Editor body -->
<div class="flex flex-1 min-h-0 overflow-hidden flex-col">
  <div class="flex flex-1 min-h-0 overflow-hidden">
    <FlowSidebar />
    <FlowCanvas />
  </div>
  {#if flowEditorState.consoleOpen}
    <ConsolePanel />
  {/if}
</div>
```

**Step 4: Commit**
```bash
git add src/routes/flow-editor/\[id\]/+page.svelte
git commit -m "feat(flow-editor): integrate ConsolePanel and simulate structured test run output"
```

---

### Task 5: Collapsed sidemenu with icons

**Files:**
- Modify: `src/lib/components/flow-editor/FlowSidebar.svelte`

When `collapsed === true`, render icon-only buttons instead of hiding all content. The collapsed state stays at `w-9`. Buttons are `w-7 h-7` centered with `title` tooltips.

**Step 1: Replace the `{#if !collapsed}` content block**

Current structure (simplified):
```svelte
{#if !collapsed}
  <div class="flex-1 overflow-y-auto py-3 px-2 space-y-5">
    <!-- Inputs section -->
    <!-- Agents section -->
  </div>
{/if}
```

Replace with:
```svelte
{#if collapsed}
  <!-- Icon-only column when collapsed -->
  <div class="flex-1 overflow-y-auto py-2 flex flex-col items-center gap-1">
    <!-- Prompt Box icon -->
    <button
      onclick={addPromptBox}
      class="flex items-center justify-center w-7 h-7 rounded-lg hover:bg-bg3 transition-colors border border-transparent hover:border-border/60"
      title="Prompt Box"
    >
      <Type size={13} class="text-violet-400" />
    </button>

    {#if gw.agents.length > 0}
      <div class="w-4 h-px bg-border/40 my-0.5"></div>
      {#each gw.agents as agent (agent.id)}
        <button
          onclick={() => addAgentNode(agent.id, agent.name ?? agent.id)}
          class="flex items-center justify-center w-7 h-7 rounded-lg hover:bg-bg3 transition-colors border border-transparent hover:border-border/60 text-sm"
          title={agent.name ?? agent.id}
        >
          {#if agent.emoji}
            {agent.emoji}
          {:else}
            <Bot size={13} class="text-indigo-400" />
          {/if}
        </button>
      {/each}
    {/if}
  </div>
{:else}
  <div class="flex-1 overflow-y-auto py-3 px-2 space-y-5">
    <!-- Inputs section -->
    <div>
      <p class="text-[9px] font-semibold text-muted/50 uppercase tracking-widest px-1 mb-1.5">
        Inputs
      </p>
      <button
        onclick={addPromptBox}
        class="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-left hover:bg-bg3 transition-colors border border-transparent hover:border-border/60"
      >
        <div class="w-6 h-6 rounded bg-violet-500/20 flex items-center justify-center shrink-0">
          <Type size={12} class="text-violet-400" />
        </div>
        <div>
          <div class="text-xs font-medium text-foreground">Prompt Box</div>
          <div class="text-[10px] text-muted">Text input node</div>
        </div>
      </button>
    </div>

    <!-- Agents section -->
    <div>
      <p class="text-[9px] font-semibold text-muted/50 uppercase tracking-widest px-1 mb-1.5">
        Agents
      </p>
      {#if gw.agents.length === 0}
        <p class="text-[10px] text-muted/50 italic px-2 py-1">No agents connected.</p>
      {:else}
        <div class="flex flex-col gap-0.5">
          {#each gw.agents as agent (agent.id)}
            <button
              onclick={() => addAgentNode(agent.id, agent.name ?? agent.id)}
              class="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-left hover:bg-bg3 transition-colors border border-transparent hover:border-border/60"
            >
              <div class="w-6 h-6 rounded bg-indigo-500/20 flex items-center justify-center shrink-0 text-sm">
                {#if agent.emoji}
                  {agent.emoji}
                {:else}
                  <Bot size={12} class="text-indigo-400" />
                {/if}
              </div>
              <div class="min-w-0">
                <div class="text-xs font-medium text-foreground truncate">{agent.name ?? agent.id}</div>
              </div>
            </button>
          {/each}
        </div>
      {/if}
    </div>
  </div>
{/if}
```

**Step 2: Commit**
```bash
git add src/lib/components/flow-editor/FlowSidebar.svelte
git commit -m "feat(flow-editor): show icon-only palette items when sidebar is collapsed"
```

---

### Task 6: Drag-to-create nodes from sidebar

**Files:**
- Modify: `src/lib/components/flow-editor/FlowSidebar.svelte`
- Modify: `src/lib/components/flow-editor/FlowCanvas.svelte`

@xyflow/svelte's standard DnD pattern: sidebar items write a JSON payload to `dataTransfer` on `dragstart`; the canvas div handles `dragover` (to allow drop) and `drop` (to create the node at flow coordinates).

**Step 1: Update `FlowSidebar.svelte` — add drag handlers**

Add a helper function in `<script>`:
```ts
function handleDragStart(e: DragEvent, payload: { type: 'agent' | 'promptBox'; agentId?: string; label?: string }) {
  if (!e.dataTransfer) return;
  e.dataTransfer.effectAllowed = 'copy';
  e.dataTransfer.setData('application/flow-node', JSON.stringify(payload));
}
```

Update each palette button to be draggable. For the Prompt Box button (both expanded and collapsed), add:
```svelte
draggable="true"
ondragstart={(e) => handleDragStart(e, { type: 'promptBox', label: 'Prompt' })}
```

For each agent button (both expanded and collapsed):
```svelte
draggable="true"
ondragstart={(e) => handleDragStart(e, { type: 'agent', agentId: agent.id, label: agent.name ?? agent.id })}
```

**Step 2: Update `FlowCanvas.svelte` — add drop handling**

Add `useSvelteFlow` import:
```ts
import {
  SvelteFlow,
  Background,
  Controls,
  MiniMap,
  addEdge,
  useSvelteFlow,
  type Connection,
  type NodeTypes,
  type EdgeTypes,
  type ColorMode,
} from '@xyflow/svelte';
```

Add in script (must be inside component, after SvelteFlow renders):
```ts
const { screenToFlowPosition } = useSvelteFlow();

function handleDrop(e: DragEvent) {
  e.preventDefault();
  const raw = e.dataTransfer?.getData('application/flow-node');
  if (!raw) return;

  let payload: { type: 'agent' | 'promptBox'; agentId?: string; label?: string };
  try { payload = JSON.parse(raw); } catch { return; }

  const position = screenToFlowPosition({ x: e.clientX, y: e.clientY });

  if (payload.type === 'promptBox') {
    const node: FlowNode = {
      id: makeId(),
      type: 'promptBox',
      position,
      data: { label: 'Prompt', value: '' } satisfies PromptBoxData,
    };
    setEdgesLocal(flowEditorState.edges as FlowEdge[]);
    setNodes([...flowEditorState.nodes, node]);
  } else if (payload.type === 'agent' && payload.agentId) {
    const node: FlowNode = {
      id: makeId(),
      type: 'agent',
      position,
      data: {
        agentId: payload.agentId,
        label: payload.label ?? payload.agentId,
        defaultValues: {},
        contextRules: [],
        inputHandles: [{ id: 'in', label: 'input' }],
        outputHandles: [{ id: 'out', label: 'output' }],
        contextHandles: [{ id: 'ctx', label: 'context' }],
      } satisfies AgentNodeData,
    };
    setNodes([...flowEditorState.nodes, node]);
  }
}
```

Add the following imports in the script:
```ts
import type { AgentNodeData, PromptBoxData } from '$lib/state/flow-editor.svelte';
```

Add a `makeId` helper:
```ts
function makeId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}
```

Note: `setEdgesLocal` is just `setEdges` — the line `setEdgesLocal(...)` in the agent branch should be removed (it was a copy-paste error in drafting). Only `setNodes` is needed.

**Step 3: Update the canvas container div to handle drop events**

Find:
```svelte
<div
  class="flex-1 h-full {flowEditorState.relationshipMode ? 'cursor-crosshair' : ''}"
>
```

Replace with:
```svelte
<div
  class="flex-1 h-full {flowEditorState.relationshipMode ? 'cursor-crosshair' : ''}"
  ondragover={(e) => e.preventDefault()}
  ondrop={handleDrop}
>
```

**Step 4: Verify drag-to-create works**
1. Open the flow editor
2. Drag "Prompt Box" from the sidebar onto the canvas — a prompt box node should appear at the drop position
3. Drag an agent from the sidebar — an agent node should appear at the drop position
4. Repeat from collapsed sidebar (icon-only mode)

**Step 5: Commit**
```bash
git add src/lib/components/flow-editor/FlowCanvas.svelte src/lib/components/flow-editor/FlowSidebar.svelte
git commit -m "feat(flow-editor): drag-to-create nodes from palette sidebar"
```
