/**
 * Phase D-0c — debug stepped-build state.
 *
 * Per-session ring buffer of debug.step.* events received via WS, plus the
 * currently-paused step. Hub admin opts in by calling debug.setSteppedBuild,
 * then clicks Continue/Skip-all/Cancel as gates fire.
 */

import type { Snippet } from 'svelte';

export type DebugStepName =
  | 'agent_resolved'
  | 'eligible_pool_computed'
  | 'pre_prompt_build_dispatched'
  | 'pre_prompt_build_merged'
  | 'llm_call_starting'
  | 'section_assembly_started'
  | 'prompt_assembled'
  | 'pre_prompt_build_handler';

export type DebugStepEvent = {
  category: 'debug.step';
  step: DebugStepName;
  sessionKey: string;
  agentId?: string;
  state: Record<string, unknown>;
  ts: number;
};

export const ALL_GATES: DebugStepName[] = [
  'agent_resolved',
  'eligible_pool_computed',
  'pre_prompt_build_dispatched',
  'pre_prompt_build_merged',
  'llm_call_starting',
  'section_assembly_started',
  'prompt_assembled',
  'pre_prompt_build_handler',
];

export const GATE_LABEL: Record<DebugStepName, string> = {
  agent_resolved: 'Agent resolved',
  eligible_pool_computed: 'Eligible pool computed',
  pre_prompt_build_dispatched: 'pre_prompt_build dispatched',
  pre_prompt_build_handler: 'pre_prompt_build handler',
  pre_prompt_build_merged: 'pre_prompt_build merged',
  section_assembly_started: 'Section assembly started',
  prompt_assembled: 'Prompt assembled',
  llm_call_starting: 'LLM call starting',
};

const MAX_EVENTS_PER_SESSION = 50;

type SessionDebugState = {
  events: DebugStepEvent[];
  pausedStep: DebugStepName | null;
  steppedBuildEnabled: boolean;
  timeoutCount: number;
  lastUpdatedAt: number;
};

function emptySession(): SessionDebugState {
  return {
    events: [],
    pausedStep: null,
    steppedBuildEnabled: false,
    timeoutCount: 0,
    lastUpdatedAt: 0,
  };
}

export const debugState = $state({
  sessions: {} as Record<string, SessionDebugState>,
});

export function getSessionDebug(sessionKey: string): SessionDebugState {
  let session = debugState.sessions[sessionKey];
  if (!session) {
    session = emptySession();
    debugState.sessions[sessionKey] = session;
  }
  return session;
}

export function pushDebugStepEvent(evt: DebugStepEvent) {
  const session = getSessionDebug(evt.sessionKey);
  session.events.push(evt);
  if (session.events.length > MAX_EVENTS_PER_SESSION) {
    session.events.splice(0, session.events.length - MAX_EVENTS_PER_SESSION);
  }
  // Latest event is the gate currently paused (gateway emits then awaits).
  // Subsequent stepContinue + next gate event will overwrite this.
  session.pausedStep = evt.step;
  session.lastUpdatedAt = evt.ts;
}

export function pushDebugStepTimeout(payload: {
  sessionKey: string;
  step: DebugStepName;
  ts: number;
}) {
  const session = getSessionDebug(payload.sessionKey);
  session.timeoutCount += 1;
  session.pausedStep = null;
  session.lastUpdatedAt = payload.ts;
}

export function clearPausedStep(sessionKey: string) {
  const session = debugState.sessions[sessionKey];
  if (session) {
    session.pausedStep = null;
    session.lastUpdatedAt = Date.now();
  }
}

export function setSessionSteppedBuildEnabled(sessionKey: string, enabled: boolean) {
  const session = getSessionDebug(sessionKey);
  session.steppedBuildEnabled = enabled;
  if (!enabled) {
    session.pausedStep = null;
  }
}

export function clearSessionDebug(sessionKey: string) {
  delete debugState.sessions[sessionKey];
}

// Re-export Snippet type for component imports
export type { Snippet };
