# Workshop Conversation Persistence Design

**Date:** 2026-02-24
**Status:** Approved

## Problem

Refreshing the page while workshop agents are in a conversation resets everything: the conversation
disappears, messages are lost, and the turn-taking loop is gone. Users expect in-progress conversations
to survive a page refresh and automatically resume where they left off.

## Root Cause

Three things are currently lost on refresh:

1. **Conversation status** — `autoLoad` marks every `active` conversation as `completed`, discarding
   the in-progress state.
2. **Message history** — `conversationMessages` in `workshop-conversations.svelte.ts` is in-memory
   only (intentionally not saved to localStorage because messages are large).
3. **Orchestration loop** — `activeLoops` in `gateway-bridge.ts` is in-memory only; the async
   turn-taking generator is gone after refresh.

The gateway already stores each agent's full session transcript. `loadConversationHistory()` can
reconstruct the message list from it. The real gap is: we throw away the `active` status and the
parameters needed to continue the loop (`taskPrompt`, `maxTurns`).

## Design

### Data model changes

Add two fields to `WorkshopConversation` and extend the status union:

```ts
export interface WorkshopConversation {
  // ... existing fields ...
  status: 'active' | 'interrupted' | 'completed' | 'queued';  // add 'interrupted'
  taskPrompt?: string;   // original prompt — required to reconstruct turn prompts on resume
  maxTurns?: number;     // required to know how many turns remain
}
```

`taskPrompt` and `maxTurns` are written when a conversation is created
(`startWorkshopConversation` / `assignTask`) and live in localStorage alongside the conversation
record.

### Load-time behaviour (`autoLoad`)

Change:
```ts
// Before
if (conv.status === 'active') {
  conv.status = 'completed';
  conv.endedAt = conv.endedAt ?? Date.now();
}

// After
if (conv.status === 'active') {
  conv.status = 'interrupted';
  // endedAt deliberately not set
}
```

Conversations that were running when the page closed are preserved for resumption.

### Resume flow

A new `resumeInterruptedConversations()` function in `gateway-bridge.ts` is called from
`WorkshopCanvas.svelte` immediately after `rebuildScene()` completes (agents and FSMs are
on-canvas at that point).

**Algorithm:**

```
for each conversation where status === 'interrupted':
  1. Remap participantAgentIds → current instanceIds via workshopState.agents
     - If any participant agent is not on canvas → mark completed, skip
  2. Load history from gateway (loadConversationHistory)
     - turnCount = history.length
     - If turnCount >= maxTurns → mark completed, skip
  3. Reconstruct loop state:
     - currentTurnIdx = turnCount % participants.length
     - lastResponse   = history[last].content
     - lastAgentName  = resolved name of history[last].agentId
     - collectedMessages = history.map(m => "${name}: ${content}")
  4. Re-activate:
     - conv.status = 'active'
     - conv.participantInstanceIds = remapped current instance IDs
     - fire conversationStart FSM event for each participant
  5. Resume orchestration loop with resumeState { turnCount, currentTurnIdx,
     lastResponse, lastAgentName, collectedMessages }
```

The gateway is the source of truth for turn count — never stored in localStorage.

### `runOrchestrationLoop` changes

Add an optional `resumeState` parameter:

```ts
type ResumeState = {
  turnCount: number;
  currentTurnIdx: number;
  lastResponse: string;
  lastAgentName: string;
  collectedMessages: string[];
};

async function runOrchestrationLoop(
  conversationId: string,
  convSessionKey: string,
  participants: Participant[],
  taskPrompt: string,
  loopState: LoopState,
  resumeState?: ResumeState,
): Promise<void>
```

When `resumeState` is provided, the function skips the initial prompt to the first agent and
enters the turn loop directly from `resumeState.currentTurnIdx`.

### Files changed

| File | Change |
|------|--------|
| `src/lib/state/workshop.svelte.ts` | Add `interrupted` to status union; add `taskPrompt?`, `maxTurns?` fields; change `autoLoad` to set `interrupted` instead of `completed` |
| `src/lib/workshop/gateway-bridge.ts` | Write `taskPrompt`/`maxTurns` into conv record on create; add `resumeInterruptedConversations()`; add optional `resumeState` param to `runOrchestrationLoop` |
| `src/lib/components/workshop/WorkshopCanvas.svelte` | Call `resumeInterruptedConversations()` after `rebuildScene()` resolves |

### UI

No new components. The existing `conversationLoading` state in `workshop-conversations.svelte.ts`
already shows a loading indicator in the conversation sidebar while history is being fetched.

## Edge cases

| Case | Handling |
|------|----------|
| Agent not on canvas after refresh | Mark conversation `completed`, do not resume |
| `taskPrompt` missing (old save data) | Mark conversation `completed`, cannot resume without prompt |
| `maxTurns` missing (old save data) | Use `workshopState.settings.taskMaxTurns` as fallback |
| `turnCount >= maxTurns` after history load | Mark conversation `completed`, conversation was actually done |
| Conversation aborted mid-resume (abort called while loading history) | `aborted` flag on `loopState` stops the loop before first turn |
| Multiple refreshes | Each load marks active→interrupted and resumes; turn count always recomputed from gateway |
