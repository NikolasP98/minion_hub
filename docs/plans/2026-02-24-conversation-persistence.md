# Workshop Conversation Persistence Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** Auto-resume in-progress workshop agent conversations after a page refresh.

**Architecture:** Store `taskPrompt` + `maxTurns` in the conversation record (localStorage). On load, mark active conversations as `interrupted` instead of `completed`. After canvas rebuild, `resumeInterruptedConversations()` fetches gateway history to reconstruct turn state, then re-enters the orchestration loop from where it left off. Gateway history is the source of truth for how many turns have elapsed.

**Design doc:** `docs/plans/2026-02-24-conversation-persistence-design.md`

**Tech Stack:** Svelte 5 runes, TypeScript, existing gateway WebSocket bridge (`sendRequest`, `chat.history`), `runed` FiniteStateMachine.

---

## Task 1: Extend `WorkshopConversation` type + fix `autoLoad`

**Files:**
- Modify: `src/lib/state/workshop.svelte.ts`

### Step 1: Update the `WorkshopConversation` interface

Find the interface (starts at line 18) and apply these changes:

```ts
export interface WorkshopConversation {
  id: string;
  type: 'task' | 'banter';
  participantInstanceIds: string[];
  participantAgentIds: string[];
  sessionKey: string;
  status: 'active' | 'interrupted' | 'completed' | 'queued';  // add 'interrupted'
  startedAt: number;
  endedAt?: number;
  title?: string;
  taskPrompt?: string;   // NEW: original prompt for reconstructing turns on resume
  maxTurns?: number;     // NEW: total allowed turns, needed to compute remaining turns
}
```

### Step 2: Update `autoLoad` — mark active as interrupted

In `autoLoad` (around line 165), change:

```ts
// BEFORE
if (conv.status === 'active') {
  conv.status = 'completed';
  conv.endedAt = conv.endedAt ?? Date.now();
}

// AFTER
if (conv.status === 'active') {
  conv.status = 'interrupted';
  // deliberately do NOT set endedAt — conversation is pending resumption
}
```

### Step 3: Run type check

```bash
bun run check
```

Expected: 0 errors.

### Step 4: Commit

```bash
git add src/lib/state/workshop.svelte.ts
git commit --no-gpg-sign -m "feat(workshop): add interrupted conversation status + taskPrompt/maxTurns fields"
```

---

## Task 2: Persist `taskPrompt` and `maxTurns` when conversations are created

**Files:**
- Modify: `src/lib/workshop/gateway-bridge.ts`

### Context

`startWorkshopConversation` calls `startConversation()` from `conversation-manager.ts` which creates the record. After `startConversation` returns the `conversationId`, we need to write `taskPrompt` and `maxTurns` into the conversation record in `workshopState.conversations[conversationId]`.

Same for `assignTask`.

### Step 1: Store params in `startWorkshopConversation`

In `startWorkshopConversation`, after the `startConversation` call succeeds (line ~153), add:

```ts
const conversationId = startConversation('task', participantInstanceIds, agentIds, convSessionKey, title);
if (!conversationId) {
  console.warn('[workshop-bridge] Conversation manager rejected the conversation');
  return null;
}

// NEW: persist resume state
const convRecord = workshopState.conversations[conversationId];
if (convRecord) {
  convRecord.taskPrompt = taskPrompt;
  convRecord.maxTurns = effectiveMaxTurns;
}
```

### Step 2: Store params in `assignTask`

In `assignTask`, after the `startConversation` call (line ~242):

```ts
const conversationId = startConversation('task', [instanceId], [inst.agentId], convSessionKey);
if (!conversationId) return null;

// NEW: persist resume state
const convRecord = workshopState.conversations[conversationId];
if (convRecord) {
  convRecord.taskPrompt = taskPrompt;
  convRecord.maxTurns = 1;
}
```

### Step 3: Run type check

```bash
bun run check
```

Expected: 0 errors.

### Step 4: Commit

```bash
git add src/lib/workshop/gateway-bridge.ts
git commit --no-gpg-sign -m "feat(workshop): persist taskPrompt and maxTurns in conversation record"
```

---

## Task 3: Add `resumeState` parameter to `runOrchestrationLoop`

**Files:**
- Modify: `src/lib/workshop/gateway-bridge.ts`

### Context

`runOrchestrationLoop` currently always starts from turn 0 by sending an initial prompt to the first participant. When resuming, we need to skip that and enter the turn loop from a specific point with pre-loaded history.

### Step 1: Add the `ResumeState` type (module-level, near other type definitions)

Above `runOrchestrationLoop`, add:

```ts
interface ResumeState {
  turnCount: number;
  currentTurnIdx: number;
  lastResponse: string;
  lastAgentName: string;
  collectedMessages: string[];
}
```

### Step 2: Update `runOrchestrationLoop` signature

Change the function signature from:
```ts
async function runOrchestrationLoop(
  conversationId: string,
  convSessionKey: string,
  participants: Array<{ instanceId: string; agentId: string }>,
  taskPrompt: string,
  loopState: { aborted: boolean; turnCount: number; maxTurns: number },
): Promise<void>
```

to:
```ts
async function runOrchestrationLoop(
  conversationId: string,
  convSessionKey: string,
  participants: Array<{ instanceId: string; agentId: string }>,
  taskPrompt: string,
  loopState: { aborted: boolean; turnCount: number; maxTurns: number },
  resumeState?: ResumeState,
): Promise<void>
```

### Step 3: Apply resume branching in the function body

The current function body starts by sending the initial prompt to `participants[0]`. Wrap that in a conditional and add the resume path.

The current structure is roughly:
```ts
async function runOrchestrationLoop(...): Promise<void> {
  // build nameOf helper
  let currentTurnIdx = 0;
  let previousResponse = '';
  let previousAgentName = '';
  const collectedMessages: string[] = [];

  const firstParticipant = participants[0];
  // ... build initialPrompt ...

  try {
    // send to firstParticipant, get response
    // ... set previousResponse, previousAgentName, loopState.turnCount++, push collectedMessages ...
    // emitMessage(...)

    // while loop for remaining turns
    while (loopState.turnCount < loopState.maxTurns && !loopState.aborted) { ... }
  } finally { ... }
}
```

Replace the variable initialisation + initial-prompt block:

```ts
// Build agent name map for context formatting
const nameOf = (agentId: string): string => {
  const gwAgent = gw.agents.find((a: { id: string }) => a.id === agentId);
  return gwAgent?.name ?? agentId;
};

// Initialise from resumeState (resume path) or defaults (fresh path)
let currentTurnIdx = resumeState?.currentTurnIdx ?? 0;
let previousResponse = resumeState?.lastResponse ?? '';
let previousAgentName = resumeState?.lastAgentName ?? '';
const collectedMessages: string[] = resumeState?.collectedMessages ? [...resumeState.collectedMessages] : [];

// Sync loopState turn count from resume (gateway is source of truth)
if (resumeState) {
  loopState.turnCount = resumeState.turnCount;
}

try {
  if (!resumeState) {
    // Fresh conversation: send initial prompt to first participant
    const firstParticipant = participants[0];
    const otherNames = participants
      .slice(1)
      .map((p) => nameOf(p.agentId))
      .join(', ');
    const initialPrompt = formatInitialPrompt(taskPrompt, otherNames, participants.length, firstParticipant.agentId);

    const sessionKey = buildWorkshopSessionKey(firstParticipant.agentId, convSessionKey);
    setAgentThinking(firstParticipant.instanceId, true);
    const response = await sendAndWaitForResponse(firstParticipant.agentId, sessionKey, initialPrompt);
    setAgentThinking(firstParticipant.instanceId, false);

    if (loopState.aborted || !response) return;

    previousResponse = response;
    previousAgentName = nameOf(firstParticipant.agentId);
    loopState.turnCount++;
    collectedMessages.push(`${previousAgentName}: ${response}`);

    emitMessage({
      conversationId,
      agentId: firstParticipant.agentId,
      instanceId: firstParticipant.instanceId,
      message: response,
      timestamp: Date.now(),
    });
  }

  // Remaining turns (both fresh and resume paths reach here)
  while (loopState.turnCount < loopState.maxTurns && !loopState.aborted) {
    currentTurnIdx = (currentTurnIdx + 1) % participants.length;
    // ... rest of the loop unchanged ...
  }
} finally {
  // ... unchanged ...
}
```

> **Note:** The `while` loop body is unchanged — only the initialisation block above it changes.

### Step 4: Run type check

```bash
bun run check
```

Expected: 0 errors.

### Step 5: Commit

```bash
git add src/lib/workshop/gateway-bridge.ts
git commit --no-gpg-sign -m "feat(workshop): add resumeState param to runOrchestrationLoop"
```

---

## Task 4: Implement `resumeInterruptedConversations`

**Files:**
- Modify: `src/lib/workshop/gateway-bridge.ts`

### Context

This is the core of the feature. It's called after `rebuildScene()` completes in `WorkshopCanvas.svelte`. It finds `interrupted` conversations, reconstructs their state from gateway history, and re-enters the orchestration loop.

It returns an array of handles so `WorkshopCanvas` can track them in `activeHandles` for abort support.

### Step 1: Add the function export

Add after the `isConversationActive` function:

```ts
/**
 * Resume any conversations that were active when the page was last closed.
 * Call after canvas rebuild (agents and FSMs must be on canvas).
 *
 * Returns handles for all successfully resumed conversations.
 */
export async function resumeInterruptedConversations(): Promise<WorkshopConversationHandle[]> {
  if (!conn.connected) return [];

  const interrupted = Object.values(workshopState.conversations).filter(
    (c) => c.status === 'interrupted',
  );

  if (interrupted.length === 0) return [];

  const handles: WorkshopConversationHandle[] = [];

  for (const conv of interrupted) {
    // taskPrompt is required to reconstruct turn prompts
    if (!conv.taskPrompt) {
      conv.status = 'completed';
      conv.endedAt = Date.now();
      continue;
    }

    // Remap participantAgentIds → current instanceIds
    const remappedInstanceIds: string[] = [];
    let canResume = true;
    for (const agentId of conv.participantAgentIds) {
      const inst = Object.values(workshopState.agents).find((a) => a.agentId === agentId);
      if (!inst) {
        canResume = false;
        break;
      }
      remappedInstanceIds.push(inst.instanceId);
    }

    if (!canResume) {
      conv.status = 'completed';
      conv.endedAt = Date.now();
      continue;
    }

    // Load history from gateway to reconstruct turn state
    let history: import('$lib/state/workshop-conversations.svelte').ConversationMessage[] = [];
    try {
      history = await loadConversationHistory(conv);
    } catch {
      // If history load fails, skip this conversation rather than crashing
      conv.status = 'completed';
      conv.endedAt = Date.now();
      continue;
    }

    const effectiveMaxTurns = conv.maxTurns ?? workshopState.settings.taskMaxTurns;
    const turnCount = history.length;

    // If already at or past maxTurns, the conversation completed normally
    if (turnCount >= effectiveMaxTurns) {
      conv.status = 'completed';
      conv.endedAt = conv.endedAt ?? Date.now();
      continue;
    }

    // Reconstruct loop state from history
    const nameOf = (agentId: string): string => {
      const gwAgent = gw.agents.find((a: { id: string }) => a.id === agentId);
      return gwAgent?.name ?? agentId;
    };

    const lastMsg = history[history.length - 1];
    const resumeState: ResumeState = {
      turnCount,
      currentTurnIdx: turnCount % conv.participantAgentIds.length,
      lastResponse: lastMsg?.content ?? '',
      lastAgentName: lastMsg?.agentId ? nameOf(lastMsg.agentId) : '',
      collectedMessages: history.map((m) => `${nameOf(m.agentId ?? '')}: ${m.content}`),
    };

    // Re-activate the conversation with current instance IDs
    conv.status = 'active';
    conv.participantInstanceIds = remappedInstanceIds;

    const participants = conv.participantAgentIds.map((agentId, i) => ({
      agentId,
      instanceId: remappedInstanceIds[i],
    }));

    // Fire FSM conversationStart for all participants
    const { sendFsmEvent } = await import('./agent-fsm');
    for (const instanceId of remappedInstanceIds) {
      sendFsmEvent(instanceId, 'conversationStart');
    }

    // Guard against duplicate loops
    if (activeLoops.has(conv.id)) continue;

    const loopState = { aborted: false, turnCount, maxTurns: effectiveMaxTurns };
    activeLoops.set(conv.id, loopState);

    // Resume the orchestration loop asynchronously
    runOrchestrationLoop(
      conv.id,
      conv.sessionKey,
      participants,
      conv.taskPrompt,
      loopState,
      resumeState,
    ).catch((err) => {
      console.error('[workshop-bridge] Resume loop error:', err);
      endConversation(conv.id);
      activeLoops.delete(conv.id);
    });

    handles.push({
      conversationId: conv.id,
      abort: () => {
        loopState.aborted = true;
        endConversation(conv.id);
        activeLoops.delete(conv.id);
      },
    });
  }

  return handles;
}
```

### Step 2: Run type check

```bash
bun run check
```

Expected: 0 errors. If there are import issues with the dynamic `import('./agent-fsm')`, move the `sendFsmEvent` import to the top of the file (it's already imported — just reference the top-level import directly).

> **Note:** `sendFsmEvent` is already imported at the top of the file via `import { startConversation, endConversation } from './conversation-manager'` — check the existing imports at the top of `gateway-bridge.ts`. If `sendFsmEvent` isn't already imported, add it to the imports from `./agent-fsm` or `./conversation-manager`. Actually, `sendFsmEvent` is in `./agent-fsm` and `endConversation` is in `./conversation-manager`. Remove the dynamic import and use the top-level one.

Corrected: replace the dynamic import block with direct usage of the already-imported `sendFsmEvent` from `./agent-fsm`. Add to the top-level imports if not present:

```ts
import { sendFsmEvent } from './agent-fsm';
```

Then in the function body just call `sendFsmEvent(instanceId, 'conversationStart')` directly.

### Step 3: Run type check again

```bash
bun run check
```

Expected: 0 errors.

### Step 4: Commit

```bash
git add src/lib/workshop/gateway-bridge.ts
git commit --no-gpg-sign -m "feat(workshop): implement resumeInterruptedConversations"
```

---

## Task 5: Wire up resume in `WorkshopCanvas.svelte`

**Files:**
- Modify: `src/lib/components/workshop/WorkshopCanvas.svelte`

### Context

`resumeInterruptedConversations()` must be called after `rebuildScene()` resolves (so agents and their FSMs exist on canvas). It returns handles that need to go into `activeHandles` so the sidebar's abort button works.

The `conn.connected` guard in the existing `$effect` that calls `rebuildScene()` means we're always connected when rebuild runs.

### Step 1: Add the import

In the imports from `gateway-bridge`:

```ts
import {
  startWorkshopConversation,
  assignTask,
  onWorkshopMessage,
  resumeInterruptedConversations,   // NEW
  type WorkshopMessage,
} from '$lib/workshop/gateway-bridge';
```

### Step 2: Call it after `rebuildScene()` inside `init()`

In `pixiCanvas`'s `init()` function, after `rebuildScene()` and before the final lines, add the resume call. The current end of `init()` looks like:

```ts
await rebuildScene();

// Wire idle-banter: simulation fires this when nearby agents are idle
setBanterCallback((a, b) => launchQuickBanter(a, b));

startSimulation();

window.addEventListener('workshop:reload', handleReload);
```

Add after `startSimulation()`:

```ts
// Resume any conversations that were in-progress before the last refresh
if (!destroyed) {
  const resumedHandles = await resumeInterruptedConversations();
  for (const handle of resumedHandles) {
    activeHandles.set(handle.conversationId, handle);
  }
  if (resumedHandles.length > 0) {
    sidebarOpen = true;
  }
}
```

The `destroyed` guard prevents acting on a stale async result if the canvas was torn down while resuming.

### Step 3: Run type check

```bash
bun run check
```

Expected: 0 errors.

### Step 4: Run tests

```bash
bun run test
```

Expected: all 126 tests pass (no server-side tests are affected).

### Step 5: Commit

```bash
git add src/lib/components/workshop/WorkshopCanvas.svelte
git commit --no-gpg-sign -m "feat(workshop): auto-resume interrupted conversations after page refresh"
```

---

## Verification

1. Open the workshop in the browser (`bun run dev`)
2. Add 2 agents, start a conversation between them
3. While the conversation is actively running (agents are trading turns), refresh the page
4. **Expected:** Conversation sidebar reopens automatically, existing messages reload from gateway, and the next agent's turn fires within a few seconds
5. Let a conversation complete normally — refresh after it ends
6. **Expected:** Conversation appears in sidebar as completed with full history, no resume attempted
7. Start a conversation, refresh immediately before any response arrives
8. **Expected:** Conversation resumes and the first agent responds (turn count was 0 so fresh initial prompt is sent)
