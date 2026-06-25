// Chat + voice-turn send/load helpers (split from gateway.svelte.ts).
// These mutate per-agent chat state via `$lib/state/chat/chat.svelte` and
// dispatch through `sendRequest`. Imported through the gateway facade so
// existing `$lib/services/gateway.svelte` import paths keep working.

import { ensureAgentChat, pushChatMessage } from '$lib/state/chat/chat.svelte';
import { conn } from '$lib/state/gateway/connection.svelte';
import { uuid } from '@minion-stack/shared';
import { sendRequest } from '../gateway-rpc';

export function loadChatHistory(agentId: string): Promise<void> {
  const chat = ensureAgentChat(agentId);
  const isInitialLoad = chat.messages.length === 0;
  if (isInitialLoad) chat.loading = true;
  return sendRequest('chat.history', { sessionKey: `agent:${agentId}:main`, limit: 200 })
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

export function sendChatMsg(agentId: string) {
  const chat = ensureAgentChat(agentId);
  const msg = chat.inputText.trim();
  if (!msg || chat.sending || !conn.connected) return;

  const sessionKey = `agent:${agentId}:main`;
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
 * Floating-assistant equivalent of sendChatMsg. Same agent + main session, but the
 * message the gateway sees is prefixed with a page-context envelope (route, focus,
 * navigation instructions) so the assistant is situationally aware. The clean user
 * text — not the envelope — is what's stored in the visible transcript, exactly like
 * the voice-turn path. `context` is built by buildAssistantContext() at the callsite
 * (it needs `$app/state` page, which only resolves in the component tree).
 */
export function sendAssistantTurn(agentId: string, text: string, context: string) {
  const chat = ensureAgentChat(agentId);
  const clean = text.trim();
  if (!clean || chat.sending || !conn.connected) return;

  const sessionKey = `agent:${agentId}:main`;
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
