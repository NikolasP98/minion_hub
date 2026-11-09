/** Live-final dispatch requires the exact synchronously claimed local run. */
import { extractUiCalls, formatFollowUp, needsFollowUp, runUiCalls } from './runner';
import {
  associateRunMessage,
  claimRunFinal,
  finishRun,
  isRunCurrent,
  isSuperseded,
  pendingRuns,
  terminalRun,
  type AcceptedBinding,
} from './accepted-runs';
import { extractText } from '$lib/utils/text';
import { captureGatewaySessionOwner } from '$lib/services/gateway/session-owner.svelte';
export async function runAssistantUiCalls(
  _agentId: string,
  text: string,
  _sessionKey: string,
  binding?: AcceptedBinding,
) {
  if (!binding || binding.state !== 'claimed' || !isRunCurrent(binding)) return;
  try {
    const calls = extractUiCalls(text);
    if (!calls.length) return;
    const outcomes = await runUiCalls(calls, binding);
    if (!isRunCurrent(binding) || binding.followUpCount >= 5 || !outcomes.length) return;
    if (!outcomes.some((o) => o.contextHandoff) && !needsFollowUp(outcomes)) return;
    if (outcomes.some((o) => o.requiresUserAction)) return;
    await binding.surface.followUp(binding, formatFollowUp(outcomes) + '\n\n');
  } finally {
    finishRun(binding);
  }
}

/**
 * Recover a run whose live `final` never reached this client: the socket died
 * between a silent follow-up `chat.send` and its stream (2026-11-08, a Wi-Fi
 * roam mid dashboard build). The gateway still ran the turn and wrote the reply
 * to the transcript, so after a history reload each run we submitted and never
 * claimed is matched to its recorded reply:
 *   - the gateway stamps our run id into the recorded user turn as
 *     `"message_id"` in its untrusted-metadata fence (gateway
 *     `server-methods/chat/handlers.ts` sets `MessageSid: clientRunId`;
 *     `auto-reply/reply/inbound-meta.ts` writes it as `message_id`);
 *   - the reply is the last assistant message before the next user turn.
 * Claiming goes through `claimRunFinal`, the same authority gate as a live
 * final, so a run that is no longer current never executes; a transcript
 * message that is not ours cannot match, because the run id is a client-minted
 * UUID known only to this client's run table.
 */
type Msg = { role?: string; content?: unknown };
export type ReconcileOutcome = 'dispatched' | 'no_reply' | 'not_current' | 'expired';

/** Raw recorded text (NOT `extractText`, which strips the metadata fence we match on). */
function rawText(msg: Msg): string {
  const c = msg.content;
  if (typeof c === 'string') return c;
  if (!Array.isArray(c)) return '';
  return c
    .map((p) => (p && typeof p === 'object' && typeof p.text === 'string' ? p.text : ''))
    .join('\n');
}
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The assistant reply recorded for `runId`, or undefined while the gateway is still on it. */
export function findRunReply(messages: readonly unknown[], runId: string): Msg | undefined {
  const stamp = new RegExp(`"message_id"\\s*:\\s*"${escapeRe(runId)}"`);
  const list = messages as Msg[];
  const u = list.findIndex((m) => m?.role === 'user' && stamp.test(rawText(m)));
  if (u < 0) return;
  let reply: Msg | undefined;
  for (let i = u + 1; i < list.length; i++) {
    const m = list[i];
    if (m?.role === 'user') break;
    if (m?.role === 'assistant') reply = m;
  }
  return reply;
}

/** Claim and dispatch every pending run whose reply is now in `messages`; one outcome per run. */
/**
 * A block is meant to run seconds after the model wrote it. A pending run that
 * is older than this (lid closed mid-loop, back an hour later) is dropped
 * rather than navigating or filling forms nobody asked for any more. This
 * covers the acked-then-dead-stream case; a lost ack is cut earlier by the
 * 120 s stall timer in chat-rpc.
 */
export const RECONCILE_MAX_AGE_MS = 5 * 60_000;

export function reconcilePendingRuns(
  agentId: string,
  sessionKey: string,
  messages: readonly unknown[],
): Array<{ runId: string; outcome: ReconcileOutcome }> {
  // Never from a transcript read outside an authenticated session (a parked
  // lease passes isRunCurrent on its own).
  if (!captureGatewaySessionOwner()) return [];
  return pendingRuns(sessionKey).map((pending) => {
    if (Date.now() - pending.createdAt > RECONCILE_MAX_AGE_MS) {
      terminalRun(pending.runId, sessionKey, 'expired');
      return { runId: pending.runId, outcome: 'expired' };
    }
    // The user already sent a newer prompt: its reply must not be followed by
    // an older reply's blocks running late.
    if (isSuperseded(pending)) {
      terminalRun(pending.runId, sessionKey, 'context_changed');
      return { runId: pending.runId, outcome: 'not_current' };
    }
    const reply = findRunReply(messages, pending.runId);
    if (!reply) return { runId: pending.runId, outcome: 'no_reply' };
    const binding = claimRunFinal(pending.runId, sessionKey);
    if (!binding) return { runId: pending.runId, outcome: 'not_current' };
    associateRunMessage(reply, binding);
    void runAssistantUiCalls(agentId, extractText(reply) ?? '', sessionKey, binding);
    return { runId: pending.runId, outcome: 'dispatched' };
  });
}
