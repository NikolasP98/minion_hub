/**
 * Entry point called from the gateway chat-event handler on every live final
 * assistant reply: execute the reply's UI calls, then feed results back only
 * when the model needs them. Kept out of `runner.ts` so the pure pieces stay
 * testable without the WS/session modules.
 */
import { sendAssistantTurn } from '$lib/services/gateway/chat-rpc';
import { extractUiCalls, formatFollowUp, needsFollowUp, runUiCalls } from './runner';

// One follow-up per reply, and never more than N consecutive silent turns per
// session — a model that keeps erroring must not loop the user's session forever.
// TODO(handoff): silent follow-up turns are persisted in the gateway transcript
// (~1-2KB each); native client tools (proposal
// 2026-09-02-gateway-client-tools-webmcp-bridge) return results in-run instead.
const MAX_CHAIN = 3;
const chains = new Map<string, number>();

export async function runAssistantUiCalls(agentId: string, text: string, sessionKey: string) {
  const calls = extractUiCalls(text);
  if (calls.length === 0) {
    chains.delete(sessionKey);
    return;
  }
  const outcomes = await runUiCalls(calls);
  const chain = chains.get(sessionKey) ?? 0;
  if (!needsFollowUp(outcomes) || chain >= MAX_CHAIN) {
    chains.delete(sessionKey);
    return;
  }
  chains.set(sessionKey, chain + 1);
  sendAssistantTurn(agentId, '', formatFollowUp(outcomes) + '\n\n', sessionKey, { silent: true });
}
