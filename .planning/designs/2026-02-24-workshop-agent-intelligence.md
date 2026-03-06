# Workshop Agent Intelligence Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Give workshop agents an action queue, structured short-term memory, environment-change awareness, context compaction, a new Rulebook element, markdown chat rendering, and a debug overlay.

**Architecture:** A new `agent-queue.ts` module holds per-agent typed action queues; `element-watcher.ts` ($effect) detects element diffs and enqueues reads; `simulation.ts` drains the queue on idle windows and calls gateway-bridge; `gateway-bridge.ts` injects memory/rulebook context and scans `[REMEMBER:]` markers; `workshop.svelte.ts` stores `AgentMemory` in localStorage.

**Tech Stack:** Svelte 5 runes, TypeScript, carta-md ^4.11.1 (`Markdown.svelte` component), PixiJS 8 (for emoji reactions already in place), existing gateway WebSocket bridge.

---

## Task 1: Agent action queue module

**Files:**
- Create: `src/lib/workshop/agent-queue.ts`

**Step 1: Create the module with types and queue map**

```ts
// src/lib/workshop/agent-queue.ts

export type AgentAction =
  | { type: 'readElement';   elementId: string; priority: 'high' | 'normal' }
  | { type: 'approachAgent'; targetInstanceId: string }
  | { type: 'compactContext' }
  | { type: 'seekInfo';      elementId: string };

const QUEUE_MAX = 5;

// Priority order: lower = higher priority
const PRIORITY_ORDER: Record<AgentAction['type'], number> = {
  compactContext: 0,
  readElement:    1, // refined by action.priority below
  seekInfo:       3,
  approachAgent:  4,
};

function actionPriority(a: AgentAction): number {
  if (a.type === 'readElement') return a.priority === 'high' ? 1 : 2;
  return PRIORITY_ORDER[a.type];
}

/** Active queues keyed by agent instanceId */
const queues = new Map<string, AgentAction[]>();

/** Return the queue for an agent (creates if absent). */
function getQueue(instanceId: string): AgentAction[] {
  if (!queues.has(instanceId)) queues.set(instanceId, []);
  return queues.get(instanceId)!;
}

/**
 * Enqueue an action for an agent.
 * - `compactContext` always fits (bypasses cap).
 * - Deduplicates: won't add two identical { type, elementId/targetInstanceId } entries.
 * - Drops the oldest non-compactContext action when at cap.
 */
export function enqueue(instanceId: string, action: AgentAction): void {
  const q = getQueue(instanceId);

  // Dedup check
  const isDup = q.some((a) => {
    if (a.type !== action.type) return false;
    if (a.type === 'readElement' && action.type === 'readElement')
      return a.elementId === action.elementId;
    if (a.type === 'seekInfo' && action.type === 'seekInfo')
      return a.elementId === action.elementId;
    if (a.type === 'approachAgent' && action.type === 'approachAgent')
      return a.targetInstanceId === action.targetInstanceId;
    if (a.type === 'compactContext' && action.type === 'compactContext') return true;
    return false;
  });
  if (isDup) return;

  // Cap check (compactContext bypasses)
  if (action.type !== 'compactContext' && q.filter((a) => a.type !== 'compactContext').length >= QUEUE_MAX) {
    // Drop lowest-priority non-compact action
    let worstIdx = -1;
    let worstPri = -1;
    for (let i = 0; i < q.length; i++) {
      if (q[i].type === 'compactContext') continue;
      const pri = actionPriority(q[i]);
      if (pri > worstPri) { worstPri = pri; worstIdx = i; }
    }
    if (worstIdx >= 0) q.splice(worstIdx, 1);
  }

  q.push(action);
  q.sort((a, b) => actionPriority(a) - actionPriority(b));
}

/** Peek at the highest-priority pending action without removing it. */
export function peek(instanceId: string): AgentAction | undefined {
  return getQueue(instanceId)[0];
}

/** Remove and return the highest-priority action. */
export function dequeue(instanceId: string): AgentAction | undefined {
  return getQueue(instanceId).shift();
}

/** Get a snapshot of all queued actions (read-only). */
export function getQueue_readonly(instanceId: string): readonly AgentAction[] {
  return getQueue(instanceId);
}

/** Clear all actions for an agent (e.g. on scene reset). */
export function clearQueue(instanceId: string): void {
  queues.delete(instanceId);
}

/** Clear all queues. */
export function clearAllQueues(): void {
  queues.clear();
}
```

**Step 2: Verify type-check passes**

```bash
cd /home/nikolas/Documents/CODE/AI/minion_hub && bun run check
```
Expected: 0 errors.

**Step 3: Commit**

```bash
git add src/lib/workshop/agent-queue.ts
git commit -m "feat(workshop): add per-agent action queue module"
```

---

## Task 2: Agent memory type + state

**Files:**
- Modify: `src/lib/state/workshop.svelte.ts`

**Step 1: Add `AgentMemory` interface after the existing `InboxItem` interface (around line 48)**

```ts
export interface AgentMemory {
  contextSummary: string;
  workspaceNotes: string[];           // from [REMEMBER:] markers, max 10
  recentInteractions: string[];       // "talked to AgentX about Y", max 5
  environmentState: Record<string, { // elementId → last-read info
    summary: string;
    lastReadAt: number;
  }>;
}
```

**Step 2: Add `agentMemory` state and helpers after `markAllInboxItemsRead` (at the bottom of the file)**

The `agentMemory` map persists to localStorage under a key per host.

```ts
// --- Agent memory ---

export const agentMemory: Record<string, AgentMemory> = $state({});

function emptyMemory(): AgentMemory {
  return {
    contextSummary: '',
    workspaceNotes: [],
    recentInteractions: [],
    environmentState: {},
  };
}

export function getOrCreateMemory(instanceId: string): AgentMemory {
  if (!agentMemory[instanceId]) agentMemory[instanceId] = emptyMemory();
  return agentMemory[instanceId];
}

export function addWorkspaceNote(instanceId: string, note: string): void {
  const mem = getOrCreateMemory(instanceId);
  mem.workspaceNotes = [...mem.workspaceNotes.slice(-9), note]; // keep last 10
  saveMemory();
}

export function addRecentInteraction(instanceId: string, summary: string): void {
  const mem = getOrCreateMemory(instanceId);
  mem.recentInteractions = [...mem.recentInteractions.slice(-4), summary]; // keep last 5
  saveMemory();
}

export function updateContextSummary(instanceId: string, summary: string): void {
  const mem = getOrCreateMemory(instanceId);
  mem.contextSummary = summary;
  saveMemory();
}

export function recordElementRead(instanceId: string, elementId: string, summary: string): void {
  const mem = getOrCreateMemory(instanceId);
  mem.environmentState[elementId] = { summary, lastReadAt: Date.now() };
  saveMemory();
}

export function clearAllMemory(): void {
  for (const key of Object.keys(agentMemory)) delete agentMemory[key];
  saveMemory();
}

function memoryKey(): string {
  return `workshop:memory:${hostsState.activeHostId ?? 'default'}`;
}

function saveMemory(): void {
  try {
    localStorage.setItem(memoryKey(), JSON.stringify($state.snapshot(agentMemory)));
  } catch { /* non-critical */ }
}

export function loadMemory(): void {
  try {
    const raw = localStorage.getItem(memoryKey());
    if (!raw) return;
    const saved = JSON.parse(raw) as Record<string, AgentMemory>;
    for (const [id, mem] of Object.entries(saved)) {
      agentMemory[id] = mem;
    }
  } catch { /* non-critical */ }
}
```

**Step 3: Call `loadMemory()` inside `autoLoad()`** — add `loadMemory();` at the end of the `autoLoad` function body (after the try/catch block, around line 175).

**Step 4: Verify type-check**

```bash
bun run check
```
Expected: 0 errors.

**Step 5: Commit**

```bash
git add src/lib/state/workshop.svelte.ts
git commit -m "feat(workshop): add AgentMemory state with localStorage persistence"
```

---

## Task 3: FSM `reading` state

**Files:**
- Modify: `src/lib/workshop/agent-fsm.ts`

**Step 1: Add `reading` to `AgentFsmState` and `startReading`/`stopReading` to `AgentFsmEvent`**

In the type block:
```ts
export type AgentFsmState =
  | 'idle' | 'wandering' | 'patrolling' | 'conversing' | 'cooldown'
  | 'dragged' | 'heartbeat'
  | 'reading'; // agent is processing an environment element
```

```ts
export type AgentFsmEvent =
  | 'wander' | 'patrol' | 'stop'
  | 'conversationStart' | 'conversationEnd' | 'cooldownExpired'
  | 'pickUp' | 'putDown'
  | 'heartbeatTrigger' | 'heartbeatEnd'
  | 'startReading'  // NEW
  | 'stopReading';  // NEW
```

**Step 2: Add `reading` glow color**

In the `GLOW_COLORS` record:
```ts
reading: 0xf59e0b, // amber
```

**Step 3: Add `priorReadingState` map and `reading` state definition in `createAgentFsm`**

After `const priorDragState = new Map<string, AgentFsmState>();` at module level:
```ts
const priorReadingState = new Map<string, AgentFsmState>();
```

Add the `reading` state inside `createAgentFsm`, after the `heartbeat` state:
```ts
reading: {
  stopReading: () => {
    const prior = priorReadingState.get(instanceId) ?? 'idle';
    priorReadingState.delete(instanceId);
    return prior;
  },
  _enter() {
    setSpriteGlowColor(instanceId, GLOW_COLORS.reading);
  },
},
```

Add `startReading` to the `'*'` handler:
```ts
'*': {
  stop: 'idle',
  pickUp: () => { /* existing */ },
  startReading: () => {
    const cur = fsm.current;
    if (cur !== 'reading' && cur !== 'dragged') {
      priorReadingState.set(instanceId, cur);
    }
    return 'reading';
  },
},
```

**Step 4: Update `destroyAgentFsm` and `clearAllFsms` to clear `priorReadingState`**

```ts
export function destroyAgentFsm(instanceId: string): void {
  fsmMap.delete(instanceId);
  priorMovement.delete(instanceId);
  priorDragState.delete(instanceId);
  priorReadingState.delete(instanceId); // add this
}

export function clearAllFsms(): void {
  fsmMap.clear();
  priorMovement.clear();
  priorDragState.clear();
  priorReadingState.clear(); // add this
}
```

**Step 5: Verify type-check**

```bash
bun run check
```
Expected: 0 errors.

**Step 6: Commit**

```bash
git add src/lib/workshop/agent-fsm.ts
git commit -m "feat(workshop): add reading FSM state for element interaction"
```

---

## Task 4: Rulebook element type

**Files:**
- Modify: `src/lib/state/workshop.svelte.ts`
- Modify: `src/lib/workshop/element-sprite.ts`
- Modify: `src/lib/components/workshop/WorkshopCanvas.svelte`
- Create: `src/lib/components/workshop/RulebookOverlay.svelte`

### 4a — Types and state helpers

**Step 1: Add `'rulebook'` to `ElementType` in `workshop.svelte.ts`**

```ts
export type ElementType = 'pinboard' | 'messageboard' | 'inbox' | 'rulebook';
```

**Step 2: Add `rulebookContent?: string` to `WorkshopElement` interface**

```ts
export interface WorkshopElement {
  instanceId: string;
  type: ElementType;
  position: { x: number; y: number };
  label: string;
  pinboardItems?: PinboardItem[];
  messageBoardContent?: string;
  inboxAgentId?: string;
  inboxItems?: InboxItem[];
  outboxItems?: InboxItem[];
  rulebookContent?: string;  // ADD THIS
}
```

**Step 3: Initialize `rulebookContent` in `addElement()`**

In the `addElement` function, after the existing `if (type === 'inbox')` block:
```ts
if (type === 'rulebook') element.rulebookContent = '';
```

**Step 4: Add `setRulebookContent` helper after `setMessageBoardContent`**

```ts
export function setRulebookContent(elementId: string, content: string) {
  const el = workshopState.elements[elementId];
  if (!el || el.type !== 'rulebook') return;
  el.rulebookContent = content;
  autoSave();
}
```

### 4b — Sprite

**Step 5: Add `rulebook` to `TYPE_COLORS` and `TYPE_ICONS` in `element-sprite.ts`**

```ts
const TYPE_COLORS: Record<ElementType, number> = {
  pinboard:     0x8b6914,
  messageboard: 0x2563eb,
  inbox:        0x475569,
  rulebook:     0x1a472a, // deep green
};

const TYPE_ICONS: Record<ElementType, string> = {
  pinboard:     '\u{1F4CC}',
  messageboard: '\u{1F4CB}',
  inbox:        '\u{1F4EC}',
  rulebook:     '\u{1F4D6}', // 📖
};
```

### 4c — RulebookOverlay

**Step 6: Create `src/lib/components/workshop/RulebookOverlay.svelte`**

Exact copy of the `MessageBoardOverlay.svelte` pattern, adapted for rulebook:

```svelte
<script lang="ts">
  import { untrack } from 'svelte';
  import { workshopState, setRulebookContent } from '$lib/state/workshop.svelte';

  let {
    elementId,
    onClose,
  }: {
    elementId: string;
    onClose: () => void;
  } = $props();

  let content = $state(untrack(() => workshopState.elements[elementId]?.rulebookContent ?? ''));
  let saveTimer: ReturnType<typeof setTimeout> | null = null;

  function handleInput() {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => setRulebookContent(elementId, content), 500);
  }

  function flush() {
    if (saveTimer) { clearTimeout(saveTimer); setRulebookContent(elementId, content); }
  }

  function handleBackdropClick(e: MouseEvent) {
    if (e.target === e.currentTarget) { flush(); onClose(); }
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="fixed inset-0 z-[1000] flex items-center justify-center bg-black/40"
  onclick={handleBackdropClick}
>
  <div class="w-full max-w-md rounded-lg border border-border bg-bg2 shadow-xl">
    <div class="flex items-center justify-between border-b border-border px-4 py-2">
      <div class="flex items-center gap-2">
        <span class="text-base">📖</span>
        <span class="text-[10px] font-mono text-foreground font-semibold">Rulebook</span>
      </div>
      <div class="flex items-center gap-2">
        <span class="text-[9px] text-muted font-mono">Standing instructions injected into all agent prompts</span>
        <button class="text-[10px] font-mono text-muted hover:text-foreground" onclick={() => { flush(); onClose(); }}>x</button>
      </div>
    </div>
    <div class="p-3">
      <textarea
        class="w-full min-h-[200px] resize-y rounded border border-border bg-bg3 p-2 text-[10px] font-mono text-foreground placeholder:text-muted outline-none focus:border-accent"
        placeholder="Write standing instructions for all agents...&#10;&#10;Example:&#10;- Always respond in English&#10;- Never reveal API keys or secrets&#10;- Format code in markdown blocks"
        bind:value={content}
        oninput={handleInput}
      ></textarea>
    </div>
  </div>
</div>
```

### 4d — Wire overlay in WorkshopCanvas

**Step 7: Import `RulebookOverlay` and `setRulebookContent` in `WorkshopCanvas.svelte`**

Add to imports:
```ts
import RulebookOverlay from './RulebookOverlay.svelte';
import { ..., setRulebookContent } from '$lib/state/workshop.svelte';
```

**Step 8: Add `RulebookOverlay` to the overlay section in the template** (after `InboxOverlay`, around line 1021):

```svelte
{:else if activeOverlay.type === 'rulebook'}
  <RulebookOverlay
    elementId={activeOverlay.elementId}
    onClose={() => (activeOverlay = null)}
  />
```

**Step 9: Run type-check**

```bash
bun run check
```
Expected: 0 errors.

**Step 10: Commit**

```bash
git add src/lib/state/workshop.svelte.ts src/lib/workshop/element-sprite.ts \
        src/lib/components/workshop/RulebookOverlay.svelte \
        src/lib/components/workshop/WorkshopCanvas.svelte
git commit -m "feat(workshop): add Rulebook element type with overlay"
```

---

## Task 5: Element change watcher

**Files:**
- Create: `src/lib/workshop/element-watcher.ts`
- Modify: `src/lib/components/workshop/WorkshopCanvas.svelte`

### 5a — Watcher module

**Step 1: Create `src/lib/workshop/element-watcher.ts`**

```ts
// src/lib/workshop/element-watcher.ts
//
// Detects changes to workshop element content and enqueues agent actions.
// Designed to run as a Svelte $effect inside WorkshopCanvas.

import { workshopState } from '$lib/state/workshop.svelte';
import { agentMemory, clearAllMemory } from '$lib/state/workshop.svelte';
import { enqueue } from './agent-queue';

interface ElementSnapshot {
  messageBoardContent?: string;
  pinboardCount: number;
  inboxCount: number;
  rulebookContent?: string;
}

const snapshots = new Map<string, ElementSnapshot>();

function snap(el: (typeof workshopState.elements)[string]): ElementSnapshot {
  return {
    messageBoardContent: el.messageBoardContent,
    pinboardCount: el.pinboardItems?.length ?? 0,
    inboxCount: el.inboxItems?.length ?? 0,
    rulebookContent: el.rulebookContent,
  };
}

/**
 * Call this function inside a Svelte $effect in WorkshopCanvas.
 * It compares element state against snapshots and enqueues agent actions.
 */
export function checkElementChanges(): void {
  const agents = Object.keys(workshopState.agents);

  for (const [elementId, el] of Object.entries(workshopState.elements)) {
    const prev = snapshots.get(elementId);
    const curr = snap(el);

    if (!prev) {
      snapshots.set(elementId, curr);
      continue;
    }

    // Rulebook changed → high priority readElement for all agents + clear context summaries
    if (prev.rulebookContent !== curr.rulebookContent) {
      for (const instanceId of agents) {
        enqueue(instanceId, { type: 'readElement', elementId, priority: 'high' });
        if (agentMemory[instanceId]) agentMemory[instanceId].contextSummary = '';
      }
    }
    // Messageboard changed
    else if (prev.messageBoardContent !== curr.messageBoardContent) {
      for (const instanceId of agents) {
        enqueue(instanceId, { type: 'readElement', elementId, priority: 'high' });
      }
    }
    // Pinboard got new items
    else if (curr.pinboardCount > prev.pinboardCount) {
      for (const instanceId of agents) {
        enqueue(instanceId, { type: 'readElement', elementId, priority: 'normal' });
      }
    }
    // Inbox got new items (only target agent)
    else if (curr.inboxCount > prev.inboxCount && el.inboxAgentId) {
      const targetAgent = Object.values(workshopState.agents)
        .find((a) => a.agentId === el.inboxAgentId);
      if (targetAgent) {
        enqueue(targetAgent.instanceId, { type: 'readElement', elementId, priority: 'high' });
      }
    }

    snapshots.set(elementId, curr);
  }

  // Remove snapshots for deleted elements
  for (const id of snapshots.keys()) {
    if (!workshopState.elements[id]) snapshots.delete(id);
  }
}

/** Reset all snapshots (call on scene rebuild). */
export function resetWatcher(): void {
  snapshots.clear();
}
```

### 5b — Mount in WorkshopCanvas

**Step 2: Import and use in `WorkshopCanvas.svelte`**

Add import at top of `<script>`:
```ts
import { checkElementChanges, resetWatcher } from '$lib/workshop/element-watcher';
import { clearAllQueues } from '$lib/workshop/agent-queue';
```

Add a `$effect` block in the script section (alongside the existing `$effect` for connection state):
```ts
// Watch for element content changes and enqueue agent actions
$effect(() => {
  // Reading workshopState.elements triggers re-run on any element change
  void workshopState.elements;
  checkElementChanges();
});
```

**Step 3: Call `resetWatcher()` and `clearAllQueues()` inside `rebuildScene()`** — at the top of `rebuildScene()`, after `clearAllFsms()`:
```ts
resetWatcher();
clearAllQueues();
```

**Step 4: Run type-check**

```bash
bun run check
```
Expected: 0 errors.

**Step 5: Commit**

```bash
git add src/lib/workshop/element-watcher.ts src/lib/components/workshop/WorkshopCanvas.svelte
git commit -m "feat(workshop): add element change watcher that enqueues agent read actions"
```

---

## Task 6: Gateway bridge — memory, [REMEMBER:], rulebook, config flags, readElement/compactContext

**Files:**
- Modify: `src/lib/workshop/gateway-bridge.ts`

### 6a — Export helpers for queue drain

**Step 1: Add imports to `gateway-bridge.ts`**

```ts
import {
  agentMemory,
  getOrCreateMemory,
  addWorkspaceNote,
  addRecentInteraction,
  updateContextSummary,
  recordElementRead,
} from '$lib/state/workshop.svelte';
import { gw } from '$lib/state/gateway-data.svelte';
import { sendFsmEvent } from '$lib/workshop/agent-fsm';
import { showReactionEmoji } from '$lib/workshop/agent-sprite';
```

(Note: `gw` and `sendFsmEvent` and `showReactionEmoji` may already be imported — check and only add missing ones.)

### 6b — Rulebook context

**Step 2: Modify `getWorkshopContext()` to prepend rulebook**

Replace the current function body:

```ts
export function getWorkshopContext(agentId?: string, instanceId?: string): string {
  const parts: string[] = [];

  // 1. Rulebook (always first — standing instructions)
  const rulebooks = Object.values(workshopState.elements).filter(
    (el) => el.type === 'rulebook' && el.rulebookContent?.trim(),
  );
  for (const rb of rulebooks) {
    parts.push(`=== Standing Instructions ===\n${rb.rulebookContent!.trim()}\n=== End Standing Instructions ===`);
  }

  // 2. Agent memory context summary
  if (instanceId) {
    const mem = agentMemory[instanceId];
    if (mem?.contextSummary) {
      parts.push(`--- Your Memory Summary ---\n${mem.contextSummary}`);
    }
    if (mem?.workspaceNotes?.length) {
      parts.push(`--- Your Notes ---\n${mem.workspaceNotes.map((n) => `- ${n}`).join('\n')}`);
    }
    if (mem?.recentInteractions?.length) {
      parts.push(`--- Recent Interactions ---\n${mem.recentInteractions.map((i) => `- ${i}`).join('\n')}`);
    }
  }

  // 3. Per-agent config flags
  const gwAgent = agentId
    ? (gw.agents.find((a: { id: string }) => a.id === agentId) as { id: string; shareWorkspaceInfo?: boolean; shareUserInfo?: boolean } | undefined)
    : undefined;
  const shareWorkspace = gwAgent?.shareWorkspaceInfo !== false; // default true

  if (shareWorkspace) {
    for (const el of Object.values(workshopState.elements)) {
      if (el.type === 'messageboard' && el.messageBoardContent?.trim()) {
        parts.push(`[Message Board "${el.label}"]: ${el.messageBoardContent.trim()}`);
      }
      if (el.type === 'pinboard' && el.pinboardItems?.length) {
        const lines = [`[Pinboard "${el.label}"]:`];
        for (const pin of el.pinboardItems) lines.push(`  - ${pin.content} (by ${pin.pinnedBy})`);
        parts.push(lines.join('\n'));
      }
      if (el.type === 'inbox' && agentId && el.inboxAgentId === agentId) {
        const unread = (el.inboxItems ?? []).filter((m) => !m.read);
        if (unread.length > 0) {
          const lines = [`[Your Inbox]:`];
          for (const msg of unread) lines.push(`  - From ${msg.fromId}: ${msg.content}`);
          parts.push(lines.join('\n'));
        }
      }
    }
  }

  return parts.join('\n\n');
}
```

### 6c — [REMEMBER:] marker extraction

**Step 3: Add `extractAndApplyRemembers()` next to the existing `extractAndApplyPins`/`extractAndRouteSends` functions**

```ts
function extractAndApplyRemembers(responseText: string, instanceId: string): void {
  const rememberRegex = /\[REMEMBER:\s*(.+?)\]/gi;
  let match: RegExpExecArray | null;
  while ((match = rememberRegex.exec(responseText)) !== null) {
    addWorkspaceNote(instanceId, match[1].trim());
  }
}
```

**Step 4: Call it in `emitMessage()`, alongside `extractAndApplyPins` (around line 759)**

```ts
extractAndApplyPins(msg.message, msg.agentId);
extractAndRouteSends(msg.message, msg.agentId);
if (msg.instanceId) {
  extractAndApplyRemembers(msg.message, msg.instanceId);
}
```

### 6d — Context compaction action

**Step 5: Add `compactAgentContext()` export (call this from simulation when draining `compactContext` action)**

Add this function after `assignTask`:

```ts
/**
 * Ask an agent to summarise its recent context and save the result
 * to its memory. Prunes the in-memory message cache to the last 2 messages.
 * Called by simulation.ts when draining a compactContext queue action.
 */
export async function compactAgentContext(
  instanceId: string,
  sessionKey: string,
): Promise<void> {
  const inst = workshopState.agents[instanceId];
  if (!inst) return;

  const agentId = inst.agentId;
  const gateSessionKey = buildWorkshopSessionKey(agentId, sessionKey);

  const prompt = [
    'Summarise your recent activity and key learnings in ≤400 tokens.',
    'Retain: workspace rules, unresolved tasks, agent relationships, important decisions.',
    'Discard: pleasantries, resolved topics, repeated information.',
    'Respond with ONLY the summary — no commentary.',
  ].join('\n');

  try {
    setAgentThinking(instanceId, true);
    const summary = await sendAndWaitForResponse(agentId, gateSessionKey, prompt, 45_000);
    if (summary) {
      updateContextSummary(instanceId, summary);
      // Prune local cache to last 2 messages
      const { conversationMessages } = await import('$lib/state/workshop-conversations.svelte');
      const msgs = conversationMessages[sessionKey];
      if (msgs && msgs.length > 2) {
        const { setMessages } = await import('$lib/state/workshop-conversations.svelte');
        setMessages(sessionKey, msgs.slice(-2));
      }
    }
  } finally {
    setAgentThinking(instanceId, false);
  }
}
```

### 6e — readElement action

**Step 6: Add `readElementForAgent()` export**

```ts
/**
 * Ask an agent to process the content of a workshop element.
 * Shows a reaction emoji on the sprite, records the read in memory.
 * Called by simulation.ts when draining readElement / seekInfo actions.
 */
export async function readElementForAgent(
  instanceId: string,
  elementId: string,
  sessionKey: string,
): Promise<void> {
  const inst = workshopState.agents[instanceId];
  const el = workshopState.elements[elementId];
  if (!inst || !el) return;

  const agentId = inst.agentId;
  const gateSessionKey = buildWorkshopSessionKey(agentId, sessionKey);

  // Build element content summary
  let contentDesc = '';
  if (el.type === 'rulebook') contentDesc = el.rulebookContent?.trim() ?? '';
  else if (el.type === 'messageboard') contentDesc = el.messageBoardContent?.trim() ?? '';
  else if (el.type === 'pinboard') {
    contentDesc = (el.pinboardItems ?? []).map((p) => `- ${p.content}`).join('\n');
  } else if (el.type === 'inbox') {
    const unread = (el.inboxItems ?? []).filter((m) => !m.read);
    contentDesc = unread.map((m) => `From ${m.fromId}: ${m.content}`).join('\n');
  }

  if (!contentDesc) {
    // Nothing to read — just show emoji and mark as read
    showReactionEmoji(instanceId, '👀');
    recordElementRead(instanceId, elementId, '(empty)');
    return;
  }

  const prompt = [
    `New content on ${el.type} "${el.label}":`,
    '',
    contentDesc,
    '',
    'Process this information and update your understanding.',
    'Use [REMEMBER: your note] to record anything important for later.',
    'Respond briefly — one or two sentences is fine.',
  ].join('\n');

  // Show reading indicator emoji while processing
  showReactionEmoji(instanceId, '🔍');

  try {
    setAgentThinking(instanceId, true);
    const response = await sendAndWaitForResponse(agentId, gateSessionKey, prompt, 45_000);
    if (response) {
      extractAndApplyRemembers(response, instanceId);
      recordElementRead(instanceId, elementId, contentDesc.slice(0, 200));
      // Show a confirmation emoji
      const emoji = el.type === 'rulebook' ? '📖'
        : el.type === 'messageboard' ? '📋'
        : el.type === 'pinboard' ? '📌'
        : '📬';
      showReactionEmoji(instanceId, emoji);
    }
  } finally {
    setAgentThinking(instanceId, false);
  }
}
```

**Step 7: Also pass `instanceId` to `formatInitialPrompt` and `formatTurnPrompt`**

In `runOrchestrationLoop` (line ~322), update:
```ts
const initialPrompt = formatInitialPrompt(taskPrompt, otherNames, participants.length, firstParticipant.agentId, firstParticipant.instanceId);
```

And in the loop (line ~355):
```ts
const turnPrompt = formatTurnPrompt(
  taskPrompt, previousAgentName, previousResponse,
  loopState.turnCount, loopState.maxTurns, collectedMessages,
  participant.agentId, participant.instanceId,
);
```

Update `formatInitialPrompt` signature to accept `instanceId?`:
```ts
function formatInitialPrompt(
  taskPrompt: string,
  otherAgentNames: string,
  totalParticipants: number,
  agentId?: string,
  instanceId?: string,  // ADD
): string {
  const workshopCtx = getWorkshopContext(agentId, instanceId);  // pass instanceId
  ...
}
```

Update `formatTurnPrompt` signature similarly:
```ts
function formatTurnPrompt(
  taskPrompt: string,
  previousAgentName: string,
  previousResponse: string,
  turnNumber: number,
  maxTurns: number,
  conversationHistory: string[] = [],
  agentId?: string,
  instanceId?: string,  // ADD
): string {
  const workshopCtx = getWorkshopContext(agentId, instanceId);  // pass instanceId
  ...
}
```

Also update `assignTask`'s call to `formatInitialPrompt` — in `assignTask` (line ~252), the existing call is `sendAndWaitForResponse(agentId, sessionKey, taskPrompt)` — no format call needed there. Check for any direct calls and update.

**Step 8: Add turn counter tracking for compaction trigger**

Add to module state:
```ts
/** Track gateway turn counts per session key for compaction trigger */
const sessionTurnCounts = new Map<string, number>();
```

In `sendAndWaitForResponse`, increment the counter before returning:
```ts
// At the end, just before `resolve(lastAssistantText)`:
sessionTurnCounts.set(sessionKey, (sessionTurnCounts.get(sessionKey) ?? 0) + 1);
```

Export a helper:
```ts
export function getSessionTurnCount(sessionKey: string): number {
  return sessionTurnCounts.get(sessionKey) ?? 0;
}

export function resetSessionTurnCount(sessionKey: string): void {
  sessionTurnCounts.set(sessionKey, 0);
}
```

**Step 9: Run type-check**

```bash
bun run check
```
Expected: 0 errors.

**Step 10: Commit**

```bash
git add src/lib/workshop/gateway-bridge.ts
git commit -m "feat(workshop): memory injection, rulebook context, [REMEMBER:] marker, readElement/compactContext"
```

---

## Task 7: Simulation — seek-info timer, queue drain, spawn-above

**Files:**
- Modify: `src/lib/workshop/simulation.ts`

### 7a — New imports and state

**Step 1: Add imports at the top of `simulation.ts`**

```ts
import { peek, dequeue, enqueue, clearAllQueues } from './agent-queue';
import { getAgentState, sendFsmEvent } from './agent-fsm';
import { agentMemory } from '$lib/state/workshop.svelte';
import { getSessionTurnCount, resetSessionTurnCount, compactAgentContext, readElementForAgent } from './gateway-bridge';
```

(Note: `getAgentState` and `sendFsmEvent` are already imported — deduplicate.)

**Step 2: Add module state**

```ts
// Seek-info timers: ms until next periodic element re-read per agent
const seekInfoTimers = new Map<string, number>();
const SEEK_INFO_INTERVAL = 90_000; // ms
const SEEK_INFO_RADIUS  = 400;     // px
const ELEMENT_STALE_MS  = 5 * 60_000; // 5 min

// Compaction thresholds
const COMPACT_TURN_THRESHOLD  = 8;
const COMPACT_TOKEN_THRESHOLD = 6000;
```

### 7b — Seek-info timer tick

**Step 3: Add seek-info timer tick inside `tick()`, after the heartbeat timer block**

```ts
// --- Seek-info timers ---
for (const agent of Object.values(workshopState.agents)) {
  const id = agent.instanceId;
  const state = getAgentState(id);
  if (state === 'dragged' || state === 'conversing' || state === 'reading') continue;

  if (!seekInfoTimers.has(id)) {
    seekInfoTimers.set(id, SEEK_INFO_INTERVAL);
    continue;
  }

  const remaining = seekInfoTimers.get(id)! - dt;
  if (remaining <= 0) {
    seekInfoTimers.set(id, SEEK_INFO_INTERVAL);
    // Enqueue seekInfo for nearest stale element
    const nearbyEls = findNearbyElements(agent.position, SEEK_INFO_RADIUS);
    for (const { elementId } of nearbyEls) {
      const mem = agentMemory[id];
      const lastRead = mem?.environmentState[elementId]?.lastReadAt ?? 0;
      if (Date.now() - lastRead > ELEMENT_STALE_MS) {
        enqueue(id, { type: 'seekInfo', elementId });
        break;
      }
    }
  } else {
    seekInfoTimers.set(id, remaining);
  }
}
```

### 7c — Compaction check

**Step 4: Add compaction check inside `tick()`, after seek-info timers**

```ts
// --- Compaction check ---
for (const agent of Object.values(workshopState.agents)) {
  const id = agent.instanceId;
  const state = getAgentState(id);
  if (state === 'dragged' || state === 'conversing' || state === 'reading') continue;

  // Find the most recent conversation session key for this agent
  const agentConvs = Object.values(workshopState.conversations)
    .filter((c) => c.participantInstanceIds.includes(id) && c.sessionKey);
  if (agentConvs.length === 0) continue;

  const latestConv = agentConvs.sort((a, b) => b.startedAt - a.startedAt)[0];
  const sessionKey = latestConv.sessionKey;

  const turns = getSessionTurnCount(buildWorkshopSessionKey_public(agent.agentId, sessionKey));
  if (turns >= COMPACT_TURN_THRESHOLD) {
    enqueue(id, { type: 'compactContext' });
  }
}
```

You'll need to export the session key builder. Add this export to `gateway-bridge.ts`:
```ts
export function buildWorkshopSessionKey_public(agentId: string, conversationId: string): string {
  return `agent:${agentId}:workshop:${conversationId}`;
}
```

And import it in `simulation.ts`.

### 7d — Queue drain on idle windows

**Step 5: Add queue drain inside `tick()`, after the compaction check block**

```ts
// --- Drain action queue for idle agents ---
for (const agent of Object.values(workshopState.agents)) {
  const id = agent.instanceId;
  const state = getAgentState(id);

  // Only drain when agent is idle or just reached its wander destination
  if (state !== 'idle' && state !== 'heartbeat') continue;
  if (state === 'heartbeat') continue; // let heartbeat finish first

  const action = peek(id);
  if (!action) continue;

  const agentConvs = Object.values(workshopState.conversations)
    .filter((c) => c.participantInstanceIds.includes(id));
  const sessionKey = agentConvs.length > 0
    ? agentConvs.sort((a, b) => b.startedAt - a.startedAt)[0].sessionKey
    : `solo:${agent.agentId}`;

  if (action.type === 'readElement' || action.type === 'seekInfo') {
    const elementId = action.elementId;
    dequeue(id);
    sendFsmEvent(id, 'startReading');
    // Run async, then stop reading when done
    readElementForAgent(id, elementId, sessionKey).then(() => {
      sendFsmEvent(id, 'stopReading');
    }).catch(() => {
      sendFsmEvent(id, 'stopReading');
    });
  } else if (action.type === 'compactContext') {
    dequeue(id);
    sendFsmEvent(id, 'startReading');
    const fullSessionKey = buildWorkshopSessionKey_public(agent.agentId, sessionKey);
    compactAgentContext(id, sessionKey).then(() => {
      resetSessionTurnCount(fullSessionKey);
      sendFsmEvent(id, 'stopReading');
    }).catch(() => {
      sendFsmEvent(id, 'stopReading');
    });
  } else if (action.type === 'approachAgent') {
    dequeue(id);
    // Set wander target toward the target agent
    const targetInst = workshopState.agents[action.targetInstanceId];
    if (targetInst) {
      wanderTargets.set(id, {
        x: targetInst.position.x + (Math.random() - 0.5) * 40,
        y: targetInst.position.y + (Math.random() - 0.5) * 40,
      });
      sendFsmEvent(id, 'wander');
    }
  }
}
```

### 7e — Spawn above env elements

**Step 6: Export `computeSpawnY` from simulation**

Add this export at the bottom of the file:
```ts
/**
 * Compute the spawn Y for a new agent so it appears above existing elements.
 * @param dropY — The Y from the drop event (world coordinates)
 */
export function computeSpawnY(dropY: number): number {
  const elementYs = Object.values(workshopState.elements).map((e) => e.position.y);
  if (elementYs.length === 0) return dropY;
  const minY = Math.min(...elementYs);
  return Math.min(dropY, minY - 120);
}
```

**Step 7: Run type-check**

```bash
bun run check
```
Expected: 0 errors.

**Step 8: Commit**

```bash
git add src/lib/workshop/simulation.ts src/lib/workshop/gateway-bridge.ts
git commit -m "feat(workshop): seek-info timer, queue drain, compaction, spawn-above helper"
```

---

## Task 8: WorkshopCanvas — spawn-above + debug toggle

**Files:**
- Modify: `src/lib/components/workshop/WorkshopCanvas.svelte`

### 8a — Spawn above

**Step 1: Import `computeSpawnY` from simulation**

```ts
import { startSimulation, stopSimulation, setBanterCallback, computeSpawnY } from '$lib/workshop/simulation';
```

**Step 2: Use `computeSpawnY` in the drag-drop handler**

In `handleDrop`, replace:
```ts
const instanceId = addAgentInstance(agentData.id, worldPos.x, worldPos.y);
physics.addAgentBody(instanceId, worldPos.x, worldPos.y);
```
With:
```ts
const spawnY = computeSpawnY(worldPos.y);
const instanceId = addAgentInstance(agentData.id, worldPos.x, spawnY);
physics.addAgentBody(instanceId, worldPos.x, spawnY);
```

And update the `agentSprites.createAgentSprite` call to use `spawnY`:
```ts
worldPos.x, spawnY, worldContainer,
```

### 8b — Debug toggle

**Step 3: Add debug state variable**

```ts
let debugMode = $state(
  typeof localStorage !== 'undefined'
    ? localStorage.getItem('workshop:debugMode') === 'true'
    : false
);
```

**Step 4: Import `DebugOverlay`** (created in Task 10):
```ts
import DebugOverlay from './DebugOverlay.svelte';
```

**Step 5: Add debug toggle button to the template** — inside the `<div class="flex-1 relative overflow-hidden">` wrapper, alongside the existing "Chats" button (around line 940):

```svelte
<!-- Debug mode toggle -->
<button
  class="absolute bottom-3 left-3 z-40 flex items-center gap-1.5 px-2 py-1 rounded bg-bg2/80 backdrop-blur border border-border text-[9px] font-mono text-muted hover:text-foreground transition-colors"
  onclick={() => {
    debugMode = !debugMode;
    localStorage.setItem('workshop:debugMode', String(debugMode));
  }}
>
  {debugMode ? '🐛 debug on' : '🐛'}
</button>

{#if debugMode}
  <DebugOverlay />
{/if}
```

**Step 6: Run type-check**

```bash
bun run check
```
Expected: 0 errors.

**Step 7: Commit**

```bash
git add src/lib/components/workshop/WorkshopCanvas.svelte
git commit -m "feat(workshop): spawn agents above env elements, add debug mode toggle"
```

---

## Task 9: Markdown rendering in ConversationSidebar

**Files:**
- Modify: `src/lib/components/workshop/ConversationSidebar.svelte`

**Step 1: Import carta-md in the `<script>` block**

```ts
import { Carta } from 'carta-md';
import { Markdown } from 'carta-md';
import 'carta-md/default.css';

const carta = new Carta({});
```

**Step 2: Replace the plain-text message paragraph** (line 221):

Replace:
```svelte
<p class="text-[11px] text-foreground leading-snug mt-0.5 whitespace-pre-wrap break-words">{msg.content}</p>
```

With:
```svelte
<div class="ws-message-md text-[11px] text-foreground leading-snug mt-0.5">
  <Markdown {carta} value={msg.content} />
</div>
```

**Step 3: Add scoped CSS to match the dark theme** — add to the `<style>` block (or create one):

```css
:global(.ws-message-md) {
  /* Inline code */
  :global(code) {
    font-family: 'JetBrains Mono NF', monospace;
    font-size: 0.9em;
    background: var(--color-bg1, #1a1a1a);
    border-radius: 3px;
    padding: 0.1em 0.3em;
  }
  /* Code blocks */
  :global(pre) {
    background: var(--color-bg1, #1a1a1a);
    border-radius: 4px;
    padding: 0.5em 0.75em;
    overflow-x: auto;
    font-size: 0.85em;
  }
  /* Headings scale down */
  :global(h1) { font-size: 1.1em; font-weight: 600; margin: 0.3em 0; }
  :global(h2) { font-size: 1.05em; font-weight: 600; margin: 0.3em 0; }
  :global(h3) { font-size: 1em; font-weight: 600; margin: 0.2em 0; }
  /* Lists */
  :global(ul), :global(ol) { padding-left: 1.2em; margin: 0.2em 0; }
  :global(li) { margin: 0.1em 0; }
  /* Paragraphs */
  :global(p) { margin: 0.2em 0; }
  /* Blockquote */
  :global(blockquote) {
    border-left: 2px solid var(--color-border, #333);
    margin: 0.2em 0 0.2em 0.2em;
    padding-left: 0.5em;
    color: var(--color-muted, #888);
  }
}
```

**Step 4: Run type-check**

```bash
bun run check
```
Expected: 0 errors.

**Step 5: Commit**

```bash
git add src/lib/components/workshop/ConversationSidebar.svelte
git commit -m "feat(workshop): render agent messages as markdown using carta-md"
```

---

## Task 10: DebugOverlay component

**Files:**
- Create: `src/lib/components/workshop/DebugOverlay.svelte`

**Step 1: Create the component**

```svelte
<script lang="ts">
  import { workshopState } from '$lib/state/workshop.svelte';
  import { agentMemory } from '$lib/state/workshop.svelte';
  import { gw } from '$lib/state/gateway-data.svelte';
  import { worldToScreen } from '$lib/workshop/camera';
  import { getAgentState } from '$lib/workshop/agent-fsm';
  import { getQueue_readonly } from '$lib/workshop/agent-queue';

  function resolveAgentName(agentId: string): string {
    const agent = gw.agents.find((a: { id: string }) => a.id === agentId);
    return agent?.name ?? agentId;
  }

  const FSM_COLORS: Record<string, string> = {
    idle:       'text-muted',
    wandering:  'text-blue-400',
    patrolling: 'text-purple-400',
    conversing: 'text-green-400',
    cooldown:   'text-orange-400',
    dragged:    'text-yellow-400',
    heartbeat:  'text-cyan-400',
    reading:    'text-amber-400',
  };

  function actionLabel(a: ReturnType<typeof getQueue_readonly>[0]): string {
    if (a.type === 'readElement') {
      const el = workshopState.elements[a.elementId];
      return `read:${el?.label ?? a.elementId}(${a.priority})`;
    }
    if (a.type === 'seekInfo') {
      const el = workshopState.elements[a.elementId];
      return `seek:${el?.label ?? a.elementId}`;
    }
    if (a.type === 'approachAgent') return `→agent:${a.targetInstanceId.slice(-4)}`;
    return a.type;
  }
</script>

<div class="absolute inset-0 pointer-events-none overflow-hidden z-[200]">
  {#each Object.values(workshopState.agents) as agent (agent.instanceId)}
    {@const pos = worldToScreen(agent.position.x, agent.position.y, workshopState.camera)}
    {@const state = getAgentState(agent.instanceId) ?? 'idle'}
    {@const queue = getQueue_readonly(agent.instanceId)}
    {@const mem = agentMemory[agent.instanceId]}

    <!-- Only show if on screen -->
    {#if pos.x > -20 && pos.x < window.innerWidth + 20 && pos.y > -20 && pos.y < window.innerHeight + 20}
      <div
        class="absolute pointer-events-none"
        style="left: {pos.x + 36}px; top: {pos.y - 50}px; min-width: 130px; max-width: 180px;"
      >
        <div class="bg-bg2/90 border border-border/60 rounded text-[8px] font-mono p-1 space-y-0.5 backdrop-blur">
          <!-- Agent name + FSM state -->
          <div class="flex items-center gap-1">
            <span class="text-muted/80 truncate">{resolveAgentName(agent.agentId)}</span>
            <span class="shrink-0 {FSM_COLORS[state] ?? 'text-foreground'} font-semibold">·{state}</span>
          </div>

          <!-- Action queue -->
          {#if queue.length > 0}
            <div class="border-t border-border/40 pt-0.5">
              <span class="text-muted/60">queue:</span>
              {#each queue as action, i (i)}
                <div class="pl-1 text-[7px] {i === 0 ? 'text-accent' : 'text-muted/70'} truncate">
                  {i + 1}. {actionLabel(action)}
                </div>
              {/each}
            </div>
          {:else}
            <div class="text-[7px] text-muted/40">queue: empty</div>
          {/if}

          <!-- Memory summary -->
          {#if mem?.contextSummary}
            <div class="border-t border-border/40 pt-0.5">
              <span class="text-muted/60">mem:</span>
              <span class="text-muted/70 text-[7px]">{mem.contextSummary.slice(0, 60)}…</span>
            </div>
          {/if}
          {#if mem?.workspaceNotes?.length}
            <div class="text-[7px] text-muted/60">{mem.workspaceNotes.length} note(s)</div>
          {/if}
        </div>
      </div>
    {/if}
  {/each}
</div>
```

**Step 2: Run type-check**

```bash
bun run check
```
Expected: 0 errors.

**Step 3: Run full test suite**

```bash
bun run test
```
Expected: all 126 tests pass.

**Step 4: Commit**

```bash
git add src/lib/components/workshop/DebugOverlay.svelte
git commit -m "feat(workshop): add debug overlay showing FSM state, action queue, and memory"
```

---

## Final verification checklist

```bash
bun run check   # 0 errors
bun run test    # 126 tests pass
bun run build   # production build succeeds
```

Manual verification in browser:
1. Drop agents → confirm they spawn above env elements
2. Edit messageboard → confirm all agents get a `readElement(high)` queued
3. Edit rulebook → confirm all `contextSummary` slots cleared + high-priority read enqueued
4. Wait for idle agent → confirm heartbeat pulse at 10–15 s
5. Enable debug mode (🐛 button) → confirm per-agent panels show FSM state + queue
6. Trigger a banter conversation → confirm agent messages render as markdown
7. After 8+ gateway turns → confirm `compactContext` appears in debug queue
8. Add `[REMEMBER: test note]` to a manual gateway response → confirm it appears in debug panel notes
