/** Live-final dispatch requires the exact synchronously claimed local run. */
import { extractUiCalls, formatFollowUp, needsFollowUp, runUiCalls } from './runner';
import { finishRun, isRunCurrent, type AcceptedBinding } from './accepted-runs';
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
