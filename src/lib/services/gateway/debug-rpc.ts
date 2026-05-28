// Misc gateway RPC leaves (split from gateway.svelte.ts):
//  - debug stepped-build (admin-only, Phase D-0c)
//  - session/prompt/memory fetches used by inspector panels

import { sendRequest } from '../gateway.svelte';

// ─── Misc fetches ─────────────────────────────────────────────────────

export async function fetchSessionPromptReport(sessionKey: string) {
  return sendRequest('sessions.usage', {
    key: sessionKey,
    includeContextWeight: true,
    limit: 1,
  });
}

export async function fetchPromptPreview(agentId: string) {
  return sendRequest('prompt.preview', { agentId });
}

export async function fetchKGSnapshot(agentId: string) {
  return sendRequest('memory.snapshot', { agentId });
}

// ─── Debug stepped-build RPCs ─────────────────────────────────────────

export async function debugSetSteppedBuild(
  sessionKey: string,
  enabled: boolean,
  pauseTimeoutMs?: number,
) {
  return sendRequest('debug.setSteppedBuild', { sessionKey, enabled, pauseTimeoutMs });
}

export async function debugStepContinue(sessionKey: string, fromStep?: string) {
  return sendRequest('debug.stepContinue', { sessionKey, fromStep });
}

export async function debugSkipAll(sessionKey: string) {
  return sendRequest('debug.skipAll', { sessionKey });
}
