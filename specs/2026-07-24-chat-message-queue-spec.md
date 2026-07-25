# Chat message queue — spec

**Date:** 2026-07-24
**Scope:** `minion_hub` `/home` agentic chat (and every surface that calls `sendChatMsg`)
**Problem:** When the user sends a second message while the agent is still taking its
turn, the send is **silently dropped** — `sendChatMsg` early-returns on `chat.sending`
(`src/lib/services/gateway/chat-rpc.ts:59`). The user gets no feedback and the message is lost.
**Goal:** Queue mid-turn sends, show them as clearly-pending rows, and flush them
automatically (FIFO) when the turn completes.

---

## Current behavior (grounded)

| Concern         | Where                                                                             | Note                                                                                                         |
| --------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Composer submit | `ChatInput.send` → `onsubmit(composed(text), mode)` (`ChatInput.svelte:67`)       | clears its own `value`/`chips` immediately                                                                   |
| Page handler    | `handleSubmit(text, mode)` (`home/+page.svelte:622`)                              | sets `chat.inputText = text` then `sendChatMsg(agentId)`                                                     |
| Send + guard    | `sendChatMsg` (`chat-rpc.ts:56`)                                                  | **`if (!msg \|\| chat.sending \|\| !conn.connected) return;`** — the drop                                    |
| In-flight turn  | `chat.runId !== null` (`types/chat.ts:25`)                                        | authoritative for the **whole** turn; `chat.sending` (`:26`) goes false after the first token                |
| Turn complete   | `onChatEvent` `state==='final'` (`gateway.svelte.ts:1194`)                        | nulls `runId` (`:1208`), then after the smoother commits fires `notifyAgentReplyFinal` (`chat.svelte.ts:39`) |
| Done pub/sub    | `onAgentReplyFinal(cb)` / `notifyAgentReplyFinal` (`chat.svelte.ts:34,39`)        | already used by the voice engine — reuse it                                                                  |
| Terminal (also) | `state==='aborted'` (`:1222`), `'error'` (`:1243`), send catch (`chat-rpc.ts:95`) | all null `runId`                                                                                             |
| Transcript      | `.thread` list (`home/+page.svelte:993–1099`), live stream turn (`:1101–1132`)    | rows keyed by content `rowKey` (`:469`)                                                                      |

There is **no** existing queue, debounce, or pending-message concept in chat state.

**Busy predicate for the queue: `chat.runId !== null`.** (`sending` alone is too narrow —
it clears on the first delta while the agent keeps streaming.)

---

## Design (minimal — reuse state + the existing done-signal)

### Data model

Add one field to `AgentChatState` (`src/lib/types/chat.ts`):

```ts
/** Messages the user sent while runId != null, awaiting flush (FIFO). */
queued: QueuedMessage[];
```

```ts
export interface QueuedMessage {
  id: string; // client uuid — React-key + dequeue handle
  text: string; // already `composed()` (context blocks folded in)
  mode: 'ask' | 'capture';
}
```

Initialize `queued: []` in `ensureAgentChat` (`chat.svelte.ts:184`).

> ponytail: no separate store, no generic job runner. It's an array on the state that
> already exists, flushed by the pub/sub that already exists.

### Enqueue

One chokepoint: **`sendChatMsg`** (`chat-rpc.ts:56`). Replace the silent drop with an enqueue
so _every_ caller (composer Enter, feed cards, retry/edit, voice) gets queuing for free:

```ts
if (!msg || !conn.connected) return;
if (chat.sending || chat.runId !== null) {
  chat.queued.push({ id: uuid(), text: msg, mode }); // mode from chat.inputMode or param
  chat.inputText = '';
  return;
}
// …existing send path…
```

`ChatInput.send` and `handleSubmit` stay as-is — they already clear the composer optimistically,
so the message visibly leaves the input and reappears as a queued row. No busy-gating in
`ChatInput` (recon confirms it has none today).

### Flush (FIFO, one at a time)

Subscribe once (module init in `chat.svelte.ts`, next to the voice subscriber):

```ts
onAgentReplyFinal((agentId) => flushNextQueued(agentId));

function flushNextQueued(agentId: string) {
  const chat = agentChat[agentId];
  if (!chat || chat.runId !== null || chat.queued.length === 0) return;
  const next = chat.queued.shift()!;
  chat.inputText = next.text;
  sendChatMsg(agentId); // its own guard re-queues if somehow still busy
}
```

Use `onAgentReplyFinal` (not a raw `runId`-watch) so a message flushes **after** the previous
bubble has committed and history reconciled — avoids racing the typewriter smoother
(`runId` nulls at `:1208`, bubble commits in the `onDone` at `:1210`).

**Terminal-but-not-final paths** (`aborted`, `error`) don't fire `notifyAgentReplyFinal`.
Decision: on `aborted`/`error`, **do not auto-flush** — leave the queue intact and surface a
"paused — N queued" affordance (see below) with a manual **Resume** / **Clear**. Auto-flushing
into a just-errored agent would likely re-error the whole queue.

### Idempotency

Each queued message gets its own `runId`/`idempotencyKey` at actual send time (unchanged —
`sendChatMsg` mints it at `:70`). The `QueuedMessage.id` is client-only.

---

## Visual feedback (design-governance compliant)

Queued messages render as pending rows **after** the live stream turn in `.thread`
(`home/+page.svelte`), styled as a muted variant of the user bubble:

- **Row:** user-bubble geometry, but `--color-surface-2` fill (not accent), `--color-text-secondary`
  text, `opacity` via `--color` mix — reads as "not sent yet".
- **Status chip** (leading): a small `Badge`/pill "Queued" using the **neutral** status surface
  (`--color-neutral-*` / surface), never `--color-accent` (accent = action, not status — governance).
- **Order affordance:** a subtle `--space-1` left rail + count in the thinking-row region:
  “Sending after this reply · **N queued**”.
- **Per-row remove:** reuse the existing chip `X` pattern (`Button` `.chip-x`, `X size={11}`) to
  dequeue (`chat.queued = chat.queued.filter(m => m.id !== id)`).
- **Transition:** when a row flushes, it converts to the normal optimistic user bubble
  (`pushChatMessage`) — same content `rowKey`, so no remount/flicker.
- **Paused state** (after abort/error with a non-empty queue): the count line switches to
  “Paused · N queued” + **Resume** / **Clear all** (`Button` `variant="ghost"`, `size="sm"`).

All tokens semantic; no raw hex/z-index. Run `bun run lint:design && bun run lint:tokens`.

### Composer

No disable. Optionally show a one-line hint under the input when `runId !== null` and the
user is typing: “Will queue — agent is replying.” (caption type role). Enter still enqueues.

---

## Edge cases

| Case                                               | Behavior                                                                                                                                                                           |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Disconnected (`!conn.connected`)                   | Do **not** queue — keep today's return (nothing to flush into). Composer keeps the text.                                                                                           |
| Capture mode (`#`)                                 | `handleSubmit` capture branch is a no-op stub today (`+page.svelte:623`) — queue only `ask`.                                                                                       |
| New-chat / switch agent mid-queue                  | Queue is per-agent (`agentChat[agentId]`), so it stays with its agent. Starting a _new_ chat on the same agent: **clear** `queued` (the thread reset invalidates pending context). |
| 2-min send-safety timeout fires (`chat-rpc.ts:84`) | It nulls `sending`/`runId`; treat like a terminal-non-final → paused state, don't auto-flush.                                                                                      |
| Rapid multi-enqueue                                | FIFO array; flush pops one per `final`. Cap at e.g. **20** with a toast if exceeded (ponytail: hard cap, raise if anyone hits it).                                                 |
| Reload                                             | `queued` is in-memory `$state` — lost on reload (acceptable v1; persist to the chat draft store only if requested).                                                                |

---

## Build plan (phased)

1. **State + enqueue** — `QueuedMessage` type, `queued` field, `ensureAgentChat` init, swap the
   `sendChatMsg` drop for enqueue. Unit-test the guard branch (busy → pushes, idle → sends).
2. **Flush** — `flushNextQueued` + `onAgentReplyFinal` subscription; abort/error → paused.
3. **UI** — pending rows + count line + remove + resume/clear in `home/+page.svelte`; caption hint.
4. **QA** — send 3 messages mid-stream: all queue, flush in order, remove works, abort pauses.
   Gates: `bun run check`, `lint:design`, `lint:tokens`, `vitest` on the new guard test.

**Files touched:** `types/chat.ts`, `state/chat/chat.svelte.ts`, `services/gateway/chat-rpc.ts`,
`routes/(app)/home/+page.svelte` (+ its `ChatTurn`/user-bubble block). No gateway/protocol change —
this is entirely client-side sequencing over the existing `chat.send` RPC.

**Skipped (add when asked):** cross-reload persistence, drag-reorder of the queue, editing a
queued message in place, queue for voice turns.
