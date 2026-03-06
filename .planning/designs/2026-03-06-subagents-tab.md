# Subagents Tab Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a "Subagents" tab to the agent detail view showing a split-panel list of all subagent sessions with drill-down into chat/monitor/meta.

**Architecture:** New tab in AgentDetail with split layout — SubagentList (left) shows rich cards for every subagent session, SubagentDetail (right) reuses SessionViewer/SessionMonitor. Data comes from gateway `sessions.list` with `spawnedBy` filter + live WS event filtering. Requires minor gateway change to expose `spawnedBy`/`spawnDepth` in session list response.

**Tech Stack:** SvelteKit 5, Svelte runes ($state/$derived/$effect), gateway WebSocket protocol, Tailwind CSS

**Repos:**
- Gateway (openclaw): `/home/nikolas/Documents/CODE/AI/openclaw/`
- Hub UI: `/home/nikolas/Documents/CODE/AI/minion_hub/`

---

### Task 1: Expose spawnedBy/spawnDepth in Gateway Session List Response

The gateway `sessions.list` already filters by `spawnedBy` but doesn't return `spawnedBy` or `spawnDepth` in `GatewaySessionRow`. We need both fields in the response for the UI to show depth badges and parent labels.

**Files:**
- Modify: `openclaw/src/gateway/sessions/session-utils.types.ts:11-45` — add fields to `GatewaySessionRow`
- Modify: `openclaw/src/gateway/sessions/session-utils.ts:791-824` — map fields in list builder

**Step 1: Add fields to GatewaySessionRow type**

In `src/gateway/sessions/session-utils.types.ts`, add after line 41 (`lastAccountId?: string;`):

```typescript
  spawnedBy?: string;
  spawnDepth?: number;
```

**Step 2: Map fields in list builder**

In `src/gateway/sessions/session-utils.ts`, add after line 823 (`lastAccountId: ...`):

```typescript
        spawnedBy: entry?.spawnedBy,
        spawnDepth: entry?.spawnDepth,
```

**Step 3: Verify existing tests still pass**

Run: `cd /home/nikolas/Documents/CODE/AI/openclaw && npx vitest run src/gateway/sessions/session-utils.test.ts --reporter=verbose`
Expected: All existing tests pass (additive change only).

**Step 4: Commit**

```bash
cd /home/nikolas/Documents/CODE/AI/openclaw
git add src/gateway/sessions/session-utils.types.ts src/gateway/sessions/session-utils.ts
git commit -m "feat: expose spawnedBy and spawnDepth in sessions.list response"
```

---

### Task 2: Add 'subagents' to UI State

**Files:**
- Modify: `minion_hub/src/lib/state/ui.svelte.ts:4` — add `'subagents'` to activeAgentTab union type

**Step 1: Update the type union**

Find the line with `activeAgentTab` and add `'subagents'` to the union:

```typescript
activeAgentTab: 'chat' as 'chat' | 'monitor' | 'files' | 'prompt' | 'graph' | 'tools' | 'skills' | 'subagents',
```

**Step 2: Commit**

```bash
cd /home/nikolas/Documents/CODE/AI/minion_hub
git add src/lib/state/ui.svelte.ts
git commit -m "feat: add subagents to activeAgentTab type"
```

---

### Task 3: Create Subagent Data Store

**Files:**
- Create: `minion_hub/src/lib/state/subagent-data.svelte.ts`

**Step 1: Create the reactive store**

This store manages subagent session data for the currently viewed agent. It fetches on activation, filters WS events for live updates, and cleans up on deactivation.

```typescript
import { sendRequest } from '$lib/services/gateway.svelte';
import { gw } from '$lib/state/gateway-data.svelte';

// ── Types ──────────────────────────────────────────────────────

export interface SubagentSession {
  key: string;
  label?: string;
  displayName?: string;
  model?: string;
  modelProvider?: string;
  spawnedBy?: string;
  spawnDepth?: number;
  updatedAt: number | null;
  sessionId?: string;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  totalTokensFresh?: boolean;
  abortedLastRun?: boolean;
  channel?: string;
}

type SubagentStatus = 'running' | 'completed' | 'failed' | 'unknown';

// ── State ──────────────────────────────────────────────────────

export const subagentState = $state({
  agentId: null as string | null,
  sessions: [] as SubagentSession[],
  selectedKey: null as string | null,
  loading: false,
  error: null as string | null,
});

// ── Derived ────────────────────────────────────────────────────

export const selectedSubagent = $derived(
  subagentState.sessions.find((s) => s.key === subagentState.selectedKey) ?? null
);

export const sortedSubagents = $derived(() => {
  return [...subagentState.sessions].sort((a, b) => {
    const aRunning = isRunning(a);
    const bRunning = isRunning(b);
    if (aRunning !== bRunning) return aRunning ? -1 : 1;
    return (b.updatedAt ?? 0) - (a.updatedAt ?? 0);
  });
});

// ── Helpers ────────────────────────────────────────────────────

export function isRunning(s: SubagentSession): boolean {
  // Session is "running" if it has no abortedLastRun and was updated recently (within 5 min)
  const recency = Date.now() - (s.updatedAt ?? 0);
  return !s.abortedLastRun && recency < 5 * 60_000;
}

export function resolveStatus(s: SubagentSession): SubagentStatus {
  if (s.abortedLastRun) return 'failed';
  if (isRunning(s)) return 'running';
  if (s.updatedAt) return 'completed';
  return 'unknown';
}

export function formatDuration(s: SubagentSession): string {
  if (!s.updatedAt) return '—';
  // For running sessions, show elapsed from now
  // For completed, show updatedAt as relative time
  const ms = Date.now() - s.updatedAt;
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`;
  return `${Math.round(ms / 3_600_000)}h`;
}

// ── Actions ────────────────────────────────────────────────────

export async function loadSubagents(agentId: string) {
  subagentState.agentId = agentId;
  subagentState.loading = true;
  subagentState.error = null;

  try {
    const res = (await sendRequest('sessions.list', {
      agentId,
      includeGlobal: true,
      includeUnknown: true,
    })) as { sessions?: SubagentSession[] };

    // Filter to only subagent sessions (key contains `:subagent:`)
    const subagentSessions = (res.sessions ?? []).filter((s) =>
      s.key.includes(':subagent:')
    );
    subagentState.sessions = subagentSessions;
  } catch (e) {
    subagentState.error = e instanceof Error ? e.message : 'Failed to load subagents';
  } finally {
    subagentState.loading = false;
  }
}

export function handleSessionEvent(event: { key?: string; [k: string]: unknown }) {
  if (!subagentState.agentId) return;
  const key = event.key as string | undefined;
  if (!key || !key.includes(':subagent:')) return;
  // Only process events for the current agent
  if (!key.startsWith(`agent:${subagentState.agentId}:`)) return;

  const idx = subagentState.sessions.findIndex((s) => s.key === key);
  if (idx >= 0) {
    // Update existing
    Object.assign(subagentState.sessions[idx], event);
  } else {
    // New subagent appeared
    subagentState.sessions.push(event as SubagentSession);
  }
}

export function selectSubagent(key: string | null) {
  subagentState.selectedKey = key;
}

export function clearSubagents() {
  subagentState.agentId = null;
  subagentState.sessions = [];
  subagentState.selectedKey = null;
  subagentState.loading = false;
  subagentState.error = null;
}
```

**Step 2: Commit**

```bash
cd /home/nikolas/Documents/CODE/AI/minion_hub
git add src/lib/state/subagent-data.svelte.ts
git commit -m "feat: add subagent data store with WS event filtering"
```

---

### Task 4: Create SubagentCard Component

**Files:**
- Create: `minion_hub/src/lib/components/SubagentCard.svelte`

**Step 1: Create the card component**

Shows status dot, label, model, depth badge, duration, token counts, parent info. Follow the existing session list card pattern from `SessionsList.svelte` (button with `border-l-3` active indicator).

```svelte
<script lang="ts">
  import {
    type SubagentSession,
    resolveStatus,
    formatDuration,
  } from '$lib/state/subagent-data.svelte';

  let {
    session,
    selected = false,
    onclick,
  }: {
    session: SubagentSession;
    selected?: boolean;
    onclick: () => void;
  } = $props();

  const status = $derived(resolveStatus(session));

  const statusColor: Record<string, string> = {
    running: 'bg-yellow-400',
    completed: 'bg-emerald-400',
    failed: 'bg-red-400',
    unknown: 'bg-zinc-500',
  };

  const depthLabel = $derived(
    session.spawnDepth != null ? `depth ${session.spawnDepth}` : null
  );

  const tokenDisplay = $derived(() => {
    if (session.totalTokens) return `${(session.totalTokens / 1000).toFixed(1)}k tok`;
    if (session.inputTokens || session.outputTokens) {
      const inp = session.inputTokens ?? 0;
      const out = session.outputTokens ?? 0;
      return `${((inp + out) / 1000).toFixed(1)}k tok`;
    }
    return null;
  });
</script>

<button
  type="button"
  class="flex flex-col gap-1 w-full py-2.5 px-3 bg-transparent border-0
    border-b border-b-white/[0.04] border-l-3 border-l-transparent text-foreground
    cursor-pointer text-left transition-colors duration-100 hover:bg-white/[0.03]
    {selected ? '!bg-bg3 !border-l-accent' : ''}"
  {onclick}
>
  <!-- Row 1: status + label -->
  <div class="flex items-center gap-2">
    <span class="w-2 h-2 rounded-full shrink-0 {statusColor[status] ?? statusColor.unknown}"></span>
    <span class="text-[12px] font-medium truncate flex-1">
      {session.label || session.displayName || session.key.split(':').pop() || 'Unnamed'}
    </span>
    {#if status === 'running'}
      <span class="text-[10px] text-yellow-400 font-mono animate-pulse">running</span>
    {/if}
  </div>

  <!-- Row 2: model + depth -->
  <div class="flex items-center gap-2 pl-4">
    <span class="text-[10px] text-muted truncate">
      {session.model ?? 'unknown model'}
    </span>
    {#if depthLabel}
      <span class="text-[9px] px-1.5 py-0.5 rounded bg-white/[0.06] text-muted font-mono">
        {depthLabel}
      </span>
    {/if}
  </div>

  <!-- Row 3: duration + tokens + parent -->
  <div class="flex items-center gap-2 pl-4 text-[10px] text-muted/60">
    <span>{formatDuration(session)}</span>
    {#if tokenDisplay()}
      <span class="opacity-60">·</span>
      <span>{tokenDisplay()}</span>
    {/if}
    {#if session.spawnedBy && session.spawnDepth && session.spawnDepth >= 2}
      <span class="opacity-60">·</span>
      <span class="truncate">from {session.spawnedBy.split(':').pop()}</span>
    {/if}
  </div>
</button>
```

**Step 2: Commit**

```bash
cd /home/nikolas/Documents/CODE/AI/minion_hub
git add src/lib/components/SubagentCard.svelte
git commit -m "feat: add SubagentCard component with status, model, depth, tokens"
```

---

### Task 5: Create SubagentMeta Component

**Files:**
- Create: `minion_hub/src/lib/components/SubagentMeta.svelte`

**Step 1: Create the metadata display**

Shows raw session metadata in a readable key-value format.

```svelte
<script lang="ts">
  import type { SubagentSession } from '$lib/state/subagent-data.svelte';

  let { session }: { session: SubagentSession } = $props();

  const entries = $derived(
    Object.entries(session)
      .filter(([, v]) => v != null && v !== '')
      .sort(([a], [b]) => a.localeCompare(b))
  );
</script>

<div class="flex-1 min-h-0 overflow-y-auto p-4 scrollbar-thin scrollbar-color-border">
  <h3 class="text-[11px] font-semibold text-muted uppercase tracking-wider mb-3">
    Session Metadata
  </h3>
  <div class="flex flex-col gap-1.5">
    {#each entries as [key, value] (key)}
      <div class="flex gap-3 text-[11px] py-1 border-b border-white/[0.04]">
        <span class="text-muted font-mono w-36 shrink-0 truncate">{key}</span>
        <span class="text-foreground font-mono break-all">
          {typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value)}
        </span>
      </div>
    {/each}
  </div>
</div>
```

**Step 2: Commit**

```bash
cd /home/nikolas/Documents/CODE/AI/minion_hub
git add src/lib/components/SubagentMeta.svelte
git commit -m "feat: add SubagentMeta component for raw metadata display"
```

---

### Task 6: Create SubagentEmptyState Component

**Files:**
- Create: `minion_hub/src/lib/components/SubagentEmptyState.svelte`

**Step 1: Create empty state**

```svelte
<div class="flex-1 flex flex-col items-center justify-center gap-3 text-muted text-[13px] p-8">
  <span class="text-[32px] opacity-30">🔀</span>
  <span class="font-medium">No subagents spawned</span>
  <p class="text-[11px] text-center max-w-xs opacity-60 leading-relaxed">
    Subagents are autonomous child sessions that agents spawn to handle subtasks.
    They appear here when the agent uses <code class="bg-white/[0.06] px-1 rounded">sessions_spawn</code>.
    Ensure <code class="bg-white/[0.06] px-1 rounded">maxSpawnDepth</code> is at least 1 in your gateway config.
  </p>
</div>
```

**Step 2: Commit**

```bash
cd /home/nikolas/Documents/CODE/AI/minion_hub
git add src/lib/components/SubagentEmptyState.svelte
git commit -m "feat: add SubagentEmptyState component"
```

---

### Task 7: Create ViewSwitcher Component

**Files:**
- Create: `minion_hub/src/lib/components/ViewSwitcher.svelte`

**Step 1: Create view mode toggle with coming-soon badges**

```svelte
<script lang="ts">
  let { active = 'list' }: { active?: string } = $props();

  const views = [
    { id: 'list', label: 'List', enabled: true },
    { id: 'tree', label: 'Tree', enabled: false },
    { id: 'timeline', label: 'Timeline', enabled: false },
  ];
</script>

<div class="shrink-0 px-3 py-2 border-t border-border">
  <div class="text-[9px] text-muted/40 uppercase tracking-wider mb-1.5 font-semibold">View</div>
  <div class="flex gap-1.5">
    {#each views as view (view.id)}
      {#if view.enabled}
        <button
          type="button"
          class="text-[10px] px-2 py-1 rounded transition-colors
            {active === view.id
            ? 'bg-accent/20 text-accent font-medium'
            : 'text-muted hover:text-foreground hover:bg-white/[0.04]'}"
        >
          {view.label}
        </button>
      {:else}
        <span
          class="text-[10px] px-2 py-1 rounded text-muted/30 cursor-default"
          title="Coming soon"
        >
          {view.label}
          <span class="text-[8px] ml-0.5 opacity-50">soon</span>
        </span>
      {/if}
    {/each}
  </div>
</div>
```

**Step 2: Commit**

```bash
cd /home/nikolas/Documents/CODE/AI/minion_hub
git add src/lib/components/ViewSwitcher.svelte
git commit -m "feat: add ViewSwitcher with list/tree/timeline modes"
```

---

### Task 8: Create SubagentList Component

**Files:**
- Create: `minion_hub/src/lib/components/SubagentList.svelte`

**Step 1: Create the left panel list**

Scrollable list of SubagentCards with the ViewSwitcher at the bottom.

```svelte
<script lang="ts">
  import SubagentCard from './SubagentCard.svelte';
  import SubagentEmptyState from './SubagentEmptyState.svelte';
  import ViewSwitcher from './ViewSwitcher.svelte';
  import {
    subagentState,
    sortedSubagents,
    selectSubagent,
  } from '$lib/state/subagent-data.svelte';

  const sorted = $derived(sortedSubagents());
</script>

<div class="flex flex-col h-full overflow-hidden bg-bg">
  <!-- Header -->
  <div class="shrink-0 flex items-center justify-between px-3 py-2 border-b border-border">
    <span class="text-[11px] font-semibold text-muted uppercase tracking-wider">
      Subagents
    </span>
    <span class="text-[10px] text-muted/50 font-mono">
      {subagentState.sessions.length}
    </span>
  </div>

  <!-- Scrollable list -->
  <div class="flex-1 min-h-0 overflow-y-auto scrollbar-thin scrollbar-color-border">
    {#if subagentState.loading}
      <div class="flex items-center justify-center py-8 text-muted text-[11px]">
        Loading...
      </div>
    {:else if subagentState.error}
      <div class="flex items-center justify-center py-8 text-red-400 text-[11px]">
        {subagentState.error}
      </div>
    {:else if sorted.length === 0}
      <SubagentEmptyState />
    {:else}
      {#each sorted as session (session.key)}
        <SubagentCard
          {session}
          selected={subagentState.selectedKey === session.key}
          onclick={() => selectSubagent(session.key)}
        />
      {/each}
    {/if}
  </div>

  <!-- View switcher -->
  <ViewSwitcher active="list" />
</div>
```

**Step 2: Commit**

```bash
cd /home/nikolas/Documents/CODE/AI/minion_hub
git add src/lib/components/SubagentList.svelte
git commit -m "feat: add SubagentList with sorting, loading states, view switcher"
```

---

### Task 9: Create SubagentDetail Component

**Files:**
- Create: `minion_hub/src/lib/components/SubagentDetail.svelte`

**Step 1: Create the right panel detail view**

Split into Chat/Monitor/Meta sub-tabs. Reuses existing SessionViewer and SessionMonitor.

Look at `SessionViewer.svelte` and `SessionMonitor.svelte` for their exact props:
- `SessionViewer`: `{ serverId, sessionKey, session }` where session is `SessionRow | null`
- `SessionMonitor`: `{ agentId, sessionKey, serverId }`

Check `minion_hub/src/lib/types/gateway.ts` or the DB schema for `SessionRow` type. If `SessionViewer` needs a `SessionRow` from the DB (not the gateway), we may need to pass `null` and let it fetch internally, or adapt.

```svelte
<script lang="ts">
  import SessionMonitor from './SessionMonitor.svelte';
  import SubagentMeta from './SubagentMeta.svelte';
  import {
    selectedSubagent,
    subagentState,
  } from '$lib/state/subagent-data.svelte';
  import { gw } from '$lib/state/gateway-data.svelte';

  let activeTab = $state<'chat' | 'monitor' | 'meta'>('chat');

  // Reset tab when selection changes
  $effect(() => {
    if (subagentState.selectedKey) {
      activeTab = 'chat';
    }
  });

  const agentId = $derived(subagentState.agentId ?? '');
  const serverId = $derived(gw.activeServerId);
</script>

<div class="flex flex-col h-full overflow-hidden bg-bg">
  {#if !selectedSubagent}
    <div class="flex-1 flex flex-col items-center justify-center gap-2.5 text-muted text-[13px]">
      <span class="text-[28px] opacity-40">←</span>
      <span>Select a subagent to view details</span>
    </div>
  {:else}
    <!-- Header with session info -->
    <div class="shrink-0 px-4 py-2 border-b border-border bg-bg2 flex items-center gap-3">
      <span class="text-[12px] font-medium truncate">
        {selectedSubagent.label || selectedSubagent.key.split(':').pop() || 'Subagent'}
      </span>
      <span class="text-[10px] text-muted font-mono">
        {selectedSubagent.model ?? ''}
      </span>
    </div>

    <!-- Sub-tabs -->
    <div class="shrink-0 flex items-center border-b border-border bg-bg2">
      {#each ['chat', 'monitor', 'meta'] as tab (tab)}
        <button
          type="button"
          class="px-4 py-1.5 text-[10px] font-semibold border-b-2 transition-colors cursor-pointer capitalize
            {activeTab === tab
            ? 'border-accent text-accent'
            : 'border-transparent text-muted hover:text-foreground'}"
          onclick={() => (activeTab = tab)}
        >
          {tab === 'chat' ? 'Chat' : tab === 'monitor' ? 'Monitor' : 'Meta'}
        </button>
      {/each}
    </div>

    <!-- Content -->
    <div class="flex-1 min-h-0 flex flex-col overflow-hidden">
      {#if activeTab === 'chat'}
        <!-- NOTE: SessionViewer needs sessionKey. If it requires a SessionRow from DB,
             adapt by passing session=null and letting it handle missing data gracefully.
             Verify SessionViewer's behavior with a subagent session key. -->
        <SessionMonitor
          {agentId}
          sessionKey={subagentState.selectedKey}
          {serverId}
        />
      {:else if activeTab === 'monitor'}
        <SessionMonitor
          {agentId}
          sessionKey={subagentState.selectedKey}
          {serverId}
        />
      {:else}
        <SubagentMeta session={selectedSubagent} />
      {/if}
    </div>
  {/if}
</div>
```

**Implementation note:** The Chat sub-tab initially renders SessionMonitor as a placeholder. During implementation, check if `SessionViewer` can accept a subagent session key directly. If it requires a `SessionRow` from the Hub's database (which won't have subagent rows), you'll need either:
- (a) Pass `session={null}` and verify SessionViewer degrades gracefully, or
- (b) Use `sessions.preview` to fetch chat messages and render them inline, or
- (c) Reuse the Monitor view for both Chat and Monitor tabs initially

Choose (a) or (c) based on what works during implementation.

**Step 2: Commit**

```bash
cd /home/nikolas/Documents/CODE/AI/minion_hub
git add src/lib/components/SubagentDetail.svelte
git commit -m "feat: add SubagentDetail with chat/monitor/meta sub-tabs"
```

---

### Task 10: Create SubagentsTab Container

**Files:**
- Create: `minion_hub/src/lib/components/SubagentsTab.svelte`

**Step 1: Create the top-level tab component**

Manages the split panel layout and the data lifecycle (load on mount, clear on unmount, handle WS events).

```svelte
<script lang="ts">
  import SubagentList from './SubagentList.svelte';
  import SubagentDetail from './SubagentDetail.svelte';
  import {
    loadSubagents,
    clearSubagents,
    handleSessionEvent,
    subagentState,
  } from '$lib/state/subagent-data.svelte';
  import { gw } from '$lib/state/gateway-data.svelte';

  let { agentId }: { agentId: string } = $props();

  // Load subagents when agentId changes
  $effect(() => {
    if (agentId) {
      loadSubagents(agentId);
    }
    return () => {
      clearSubagents();
    };
  });

  // Subscribe to session events from the gateway store
  // The gateway-data store updates gw.sessions on WS events.
  // We watch for changes and forward subagent-related ones.
  $effect(() => {
    // This effect re-runs when gw.sessions changes (reactive dependency)
    const sessions = gw.sessions;
    // Forward any session that looks like a subagent for our agent
    for (const s of sessions) {
      if (s.sessionKey?.includes(':subagent:') && s.sessionKey?.startsWith(`agent:${agentId}:`)) {
        handleSessionEvent({ key: s.sessionKey, ...s });
      }
    }
  });
</script>

<div class="flex flex-1 min-h-0 overflow-hidden">
  <!-- Left: Subagent list -->
  <div class="w-72 border-r border-border flex-shrink-0">
    <SubagentList />
  </div>

  <!-- Right: Detail panel -->
  <div class="flex-1 min-h-0">
    <SubagentDetail />
  </div>
</div>
```

**Step 2: Commit**

```bash
cd /home/nikolas/Documents/CODE/AI/minion_hub
git add src/lib/components/SubagentsTab.svelte
git commit -m "feat: add SubagentsTab container with split layout and lifecycle"
```

---

### Task 11: Wire Tab into AgentDetail

**Files:**
- Modify: `minion_hub/src/lib/components/AgentDetail.svelte`

**Step 1: Add the Subagents tab button**

Read `AgentDetail.svelte` first. Find the tab bar `<div>` with the existing tab buttons. Add a new button after "Monitor" (or wherever makes sense):

```svelte
<button
  type="button"
  class="px-4 py-2 text-[11px] font-semibold border-b-2 transition-colors cursor-pointer
    {ui.activeAgentTab === 'subagents'
    ? 'border-accent text-accent'
    : 'border-transparent text-muted hover:text-foreground'}"
  onclick={() => (ui.activeAgentTab = 'subagents')}
>
  Subagents
</button>
```

**Step 2: Add the content block**

In the content area (the `{#if}` chain), add a block for subagents:

```svelte
{:else if ui.activeAgentTab === 'subagents'}
  <SubagentsTab agentId={selectedAgent.id} />
```

**Step 3: Add the import**

At the top of the script:

```typescript
import SubagentsTab from './SubagentsTab.svelte';
```

**Step 4: Test manually**

Run: `cd /home/nikolas/Documents/CODE/AI/minion_hub && npm run dev`
- Open the app in browser
- Select an agent
- Click "Subagents" tab
- Verify: tab renders, shows empty state or subagent list
- If connected to protopi gateway, verify subagents load from real data

**Step 5: Commit**

```bash
cd /home/nikolas/Documents/CODE/AI/minion_hub
git add src/lib/components/AgentDetail.svelte
git commit -m "feat: wire SubagentsTab into AgentDetail tab bar"
```

---

### Task 12: Integration Testing & Polish

**Step 1: Test with protopi gateway**

Connect the Hub to protopi gateway and verify:
- Subagent sessions appear in the list for the `panik` agent
- Cards show correct status, model, depth, token info
- Clicking a card loads the detail panel
- Monitor sub-tab shows tool call timeline
- Meta sub-tab shows raw metadata

**Step 2: Fix any issues found during testing**

Common things to check:
- Does `sessions.list` return subagent sessions? (they should have `:subagent:` in the key)
- Does `SessionMonitor` work with subagent session keys?
- Are `spawnedBy`/`spawnDepth` fields present after the gateway change? (requires gateway rebuild/restart)
- Does the WS event listener pick up new subagent spawns?

**Step 3: Verify the view switcher**

- "List" should be active and highlighted
- "Tree" and "Timeline" should show "soon" badge and be non-clickable
- Tooltips work on hover

**Step 4: Final commit**

```bash
cd /home/nikolas/Documents/CODE/AI/minion_hub
git add -A
git commit -m "fix: integration polish for subagents tab"
```
