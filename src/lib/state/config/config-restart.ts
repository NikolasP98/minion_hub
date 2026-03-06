/**
 * Pure restart state machine functions.
 * Separated from config.svelte.ts so they can be tested without Svelte runes.
 */

export type RestartPhase = 'idle' | 'restarting' | 'reconnected' | 'failed';

export interface RestartStateData {
  phase: RestartPhase;
  startedAt: number | null;
  hadLocalChanges: boolean;
}

/** Timeout before declaring restart failed (30s). */
export const RESTART_TIMEOUT_MS = 30_000;

/** How long to show "Changes applied" before auto-dismissing (3s). */
export const RECONNECTED_DISMISS_MS = 3_000;

export function createRestartState(): RestartStateData {
  return {
    phase: 'idle',
    startedAt: null,
    hadLocalChanges: false,
  };
}

export function applyBeginRestart(state: RestartStateData, now: number): RestartStateData {
  return {
    phase: 'restarting',
    startedAt: now,
    hadLocalChanges: false,
  };
}

export function applyReconnected(state: RestartStateData, isDirty: boolean): RestartStateData {
  return {
    ...state,
    phase: 'reconnected',
    hadLocalChanges: isDirty,
  };
}

export function applyReset(_state: RestartStateData): RestartStateData {
  return createRestartState();
}
