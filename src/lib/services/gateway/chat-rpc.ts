// Chat + voice-turn send/load helpers (split from gateway.svelte.ts).
// These mutate per-agent chat state via `$lib/state/chat/chat.svelte` and
// dispatch through `sendRequest`. Imported through the gateway facade so
// existing `$lib/services/gateway.svelte` import paths keep working.

import { ensureAgentChat, pushChatMessage } from '$lib/state/chat/chat.svelte';
import { conn } from '$lib/state/gateway/connection.svelte';
import { uuid } from '@minion-stack/shared';
import { sendRequest } from '../gateway-rpc';

export function loadChatHistory(agentId: string, sessionKey?: string): Promise<void> {
  const chat = ensureAgentChat(agentId);
  const targetSessionKey = sessionKey ?? chat.sessionKey ?? `agent:${agentId}:main`;
  chat.sessionKey = targetSessionKey;
  const isInitialLoad = chat.messages.length === 0;
  if (isInitialLoad) chat.loading = true;
  return sendRequest('chat.history', { sessionKey: targetSessionKey, limit: 200 })
    .then((res) => {
      const incoming = Array.isArray((res as { messages?: never[] })?.messages)
        ? (res as { messages: never[] }).messages
        : [];
      // Guard: never let a transient empty history response wipe a populated
      // thread (would flash it blank on a hiccup). The UI keys rows by content,
      // so this splice reconciles in place without re-mounting unchanged rows.
      if (incoming.length === 0 && chat.messages.length > 0) return;
      chat.messages.splice(0, chat.messages.length, ...incoming);
    })
    .catch(() => {})
    .finally(() => {
      chat.loading = false;
    });
}

/**
 * New chat: select a fresh named session key and clear the local thread.
 * Do not reset/archive the previous key — keeping it in the session store is
 * what makes it available from chat history.
 */
export async function resetChat(agentId: string): Promise<void> {
  const chat = ensureAgentChat(agentId);
  const nextSessionKey = `agent:${agentId}:chat:${uuid()}`;
  // Materialize the empty session immediately. Without this, the gateway only
  // creates it on first send and the history popover cannot recover an empty
  // newly-created conversation after the user switches away.
  await sendRequest('sessions.patch', { key: nextSessionKey, label: null });
  chat.messages.splice(0, chat.messages.length);
  chat.sessionKey = nextSessionKey;
  chat.stream = null;
  chat.streamMessage = null;
  chat.streamDisplay = '';
  chat.lastError = null;
  chat.liveTools = [];
  chat.liveActivity = null;
}

export function sendChatMsg(agentId: string) {
  const chat = ensureAgentChat(agentId);
  const msg = chat.inputText.trim();
  if (!msg || chat.sending || !conn.connected) return;

  const sessionKey = chat.sessionKey ?? `agent:${agentId}:main`;
  const runId = uuid();

  pushChatMessage(chat, {
    role: 'user',
    content: [{ type: 'text', text: msg }],
    timestamp: Date.now(),
  } as never);
  chat.inputText = '';
  chat.sending = true;
  chat.streamMessage = null;
  chat.runId = runId;
  chat.stream = '';
  chat.lastError = null;
  chat.liveTools = [];
  chat.liveActivity = null;

  // Keep `sending` (the "thinking" indicator) up until the run actually starts
  // streaming — the chat.send RPC resolving only means the gateway ACCEPTED the
  // message, not that the agent has produced output. onChatEvent clears `sending`
  // on the first event for this run, so the indicator hands off smoothly to the
  // streaming bubble instead of flashing out for the gap before the first token.
  // Safety net: if no event ever arrives, drop the indicator after 2 minutes.
  const guard = setTimeout(() => {
    if (chat.runId === runId) chat.sending = false;
  }, 120_000);

  sendRequest('chat.send', {
    sessionKey,
    message: msg,
    deliver: false,
    idempotencyKey: runId,
  }).catch((e) => {
    clearTimeout(guard);
    chat.runId = null;
    chat.stream = null;
    chat.streamMessage = null;
    chat.sending = false;
    chat.lastError = String(e);
    // Sync in case the message was processed despite the error
    loadChatHistory(agentId);
  });
}

/**
 * Spoken-call equivalent of sendChatMsg. Routes a transcribed utterance through
 * the same agent + main session (so prompt engineering, tools and context match
 * text chat), but prepends a voice-call header instructing short spoken replies —
 * mirroring the gateway voice-call extension's composed-message approach. The
 * clean transcript (not the header) is what shows in the chat thread, so the
 * call reads naturally in the transcript.
 */
export const VOICE_TURN_PREFIX =
  '[Voice call — the user is speaking to you out loud and will hear your reply spoken aloud. ' +
  'Reply in short, natural, spoken sentences (one to three). ' +
  'No markdown, lists, code blocks or emoji — plain spoken words only.]\n\n';

/**
 * Strip the voice-call header so the transcript reads cleanly in the UI.
 * Tolerant of whitespace drift after the gateway round-trips the message:
 * removes any leading `[Voice call …]` block, not just the exact constant.
 */
export function stripVoiceTurnPrefix(text: string): string {
  return text.replace(/^\s*\[Voice call[^\]]*\]\s*/, '');
}

/**
 * Strip the page-context envelope (buildAssistantContext) from a stored user
 * message so the transcript shows only the clean text. The gateway persists the
 * full sent message (envelope + text), so it reappears on history reload — same
 * problem stripVoiceTurnPrefix solves for voice turns. Anchored on the envelope's
 * fixed closing sentence because the block itself contains `]` (markdown links),
 * so a bracket-balanced match would stop early.
 */
export function stripAssistantContext(text: string): string {
  return text.replace(
    /^\s*\[In-app assistant context[\s\S]*?Don't restate this context\.\]\s*/,
    '',
  );
}

/** A dragged-context block parsed back out of a sent user message. */
export interface UserContextChip {
  kind: string;
  label: string;
  text: string;
}

// `[Context <kind>: <label>]<body>[/Context]` blocks composed by ChatInput.
// Whitespace-tolerant: the gateway flattens newlines to spaces when it records
// the turn, so the newlines ChatInput composes may come back as single spaces.
// Labels are bracket-sanitized at compose time, so `]` terminates the label.
const CONTEXT_CHIP_RE = /\[Context (\w+): ([^\]]*)\]\s?([\s\S]*?)\s?\[\/Context\]\s*/;

/**
 * Split a user message into its leading dragged-context chips and the typed
 * text. Chips render OUTSIDE the bubble; the bubble shows only the typed text.
 * Legacy `Context:\n…` messages (pre-marker format) pass through untouched.
 */
export function parseUserContext(text: string): { chips: UserContextChip[]; text: string } {
  const chips: UserContextChip[] = [];
  let t = text;
  for (let m = t.match(CONTEXT_CHIP_RE); m && m.index === 0; m = t.match(CONTEXT_CHIP_RE)) {
    chips.push({ kind: m[1], label: m[2], text: m[3] });
    t = t.slice(m[0].length).trimStart();
  }
  return { chips, text: t };
}

// Leading context blocks the gateway composes into the RECORDED user turn (for
// the model, not the user): semantic-recall memories, the untrusted-metadata
// JSON, the timestamp envelope, the page-context envelope, and the voice-turn
// header. The transcript stores the full composed prompt, so on history reload
// these reappear in the user bubble — strip them for display. Order-independent:
// loop until no known leading block remains, then trim.
const INBOUND_CONTEXT_BLOCKS: RegExp[] = [
  /^\s*##\s*Relevant memories\n(?:.+\n)*\n?/, // semantic recall list
  /^\s*[^\n]*\(untrusted metadata\):\s*\n```json\n[\s\S]*?\n```\s*/i, // metadata json fence
  /^\s*\[(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)[^\]]*\]\s*/, // [Thu 2026-06-25 12:00 …] timestamp
  /^\s*\[In-app assistant context[\s\S]*?Don't restate this context\.\]\s*/, // page envelope
  /^\s*\[Voice call[^\]]*\]\s*/, // voice turn
];

/**
 * Clean a USER message for display: strip every leading gateway-injected context
 * block so the bubble shows only what the user actually typed. Safe on already-
 * clean text (no-op) and on assistant replies (they don't carry these blocks).
 */
export function cleanInboundForDisplay(text: string): string {
  let t = text;
  for (let changed = true; changed;) {
    changed = false;
    for (const re of INBOUND_CONTEXT_BLOCKS) {
      const next = t.replace(re, '');
      if (next !== t) {
        t = next;
        changed = true;
      }
    }
  }
  return t.trimStart();
}

/**
 * Context-aware equivalent of sendChatMsg. Floating surfaces use the default
 * main session; `/home` passes its selected conversation key explicitly. The
 * message the gateway sees is prefixed with a page-context envelope (route,
 * focus, navigation instructions) so the assistant is situationally aware.
 * The clean user text — not the envelope — is what's stored in the visible
 * transcript, exactly like the voice-turn path. `context` is built by
 * buildAssistantContext() at the callsite (it needs `$app/state` page, which
 * only resolves in the component tree).
 */
export function sendAssistantTurn(
  agentId: string,
  text: string,
  context: string,
  sessionKey = `agent:${agentId}:main`,
) {
  const chat = ensureAgentChat(agentId);
  const clean = text.trim();
  if (!clean || chat.sending || !conn.connected) return;

  const runId = uuid();

  pushChatMessage(chat, {
    role: 'user',
    content: [{ type: 'text', text: clean }],
    timestamp: Date.now(),
  } as never);
  chat.inputText = '';
  chat.sending = true;
  chat.streamMessage = null;
  chat.runId = runId;
  chat.stream = '';
  chat.lastError = null;
  chat.liveTools = [];
  chat.liveActivity = null;

  const guard = setTimeout(() => {
    if (chat.runId === runId) chat.sending = false;
  }, 120_000);

  sendRequest('chat.send', {
    sessionKey,
    message: context + clean,
    deliver: false,
    idempotencyKey: runId,
  }).catch((e) => {
    clearTimeout(guard);
    chat.runId = null;
    chat.stream = null;
    chat.streamMessage = null;
    chat.sending = false;
    chat.lastError = String(e);
    loadChatHistory(agentId);
  });
}

export function sendVoiceTurn(agentId: string, transcript: string) {
  const chat = ensureAgentChat(agentId);
  const clean = transcript.trim();
  if (!clean || chat.sending || !conn.connected) return;

  const sessionKey = `agent:${agentId}:main`;
  const runId = uuid();

  pushChatMessage(chat, {
    role: 'user',
    content: [{ type: 'text', text: clean }],
    timestamp: Date.now(),
  } as never);
  chat.sending = true;
  chat.runId = runId;
  chat.stream = '';
  chat.lastError = null;
  chat.liveTools = [];
  chat.liveActivity = null;

  sendRequest('chat.send', {
    sessionKey,
    message: VOICE_TURN_PREFIX + clean,
    deliver: false,
    idempotencyKey: runId,
  })
    .then(() => {
      chat.sending = false;
    })
    .catch((e) => {
      chat.runId = null;
      chat.stream = null;
      chat.sending = false;
      chat.lastError = String(e);
      loadChatHistory(agentId);
    });
}
