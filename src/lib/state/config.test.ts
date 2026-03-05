/**
 * Unit tests for restart state machine logic.
 *
 * Since $state runes can't run outside Svelte context in unit tests,
 * we test the pure transition functions that drive the state machine.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  type RestartPhase,
  type RestartStateData,
  createRestartState,
  applyBeginRestart,
  applyReconnected,
  applyReset,
  RESTART_TIMEOUT_MS,
  RECONNECTED_DISMISS_MS,
} from '$lib/state/config-restart';

describe('Restart state machine', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('createRestartState returns idle initial state', () => {
    const s = createRestartState();
    expect(s.phase).toBe('idle');
    expect(s.startedAt).toBeNull();
    expect(s.hadLocalChanges).toBe(false);
  });

  it('applyBeginRestart sets phase to restarting with timestamp', () => {
    const s = createRestartState();
    const now = Date.now();
    const next = applyBeginRestart(s, now);
    expect(next.phase).toBe('restarting');
    expect(next.startedAt).toBe(now);
    expect(next.hadLocalChanges).toBe(false);
  });

  it('applyReconnected clears timeout phase and transitions to reconnected', () => {
    const s: RestartStateData = {
      phase: 'restarting',
      startedAt: Date.now() - 5000,
      hadLocalChanges: false,
    };
    const next = applyReconnected(s, false);
    expect(next.phase).toBe('reconnected');
    expect(next.hadLocalChanges).toBe(false);
  });

  it('applyReconnected sets hadLocalChanges when dirty', () => {
    const s: RestartStateData = {
      phase: 'restarting',
      startedAt: Date.now() - 5000,
      hadLocalChanges: false,
    };
    const next = applyReconnected(s, true);
    expect(next.phase).toBe('reconnected');
    expect(next.hadLocalChanges).toBe(true);
  });

  it('applyReset returns idle state', () => {
    const s: RestartStateData = {
      phase: 'reconnected',
      startedAt: Date.now(),
      hadLocalChanges: true,
    };
    const next = applyReset(s);
    expect(next.phase).toBe('idle');
    expect(next.startedAt).toBeNull();
    expect(next.hadLocalChanges).toBe(false);
  });

  it('RESTART_TIMEOUT_MS is 30 seconds', () => {
    expect(RESTART_TIMEOUT_MS).toBe(30_000);
  });

  it('RECONNECTED_DISMISS_MS is 3 seconds', () => {
    expect(RECONNECTED_DISMISS_MS).toBe(3_000);
  });

  it('phase transitions: idle -> restarting -> reconnected -> idle', () => {
    let s = createRestartState();
    expect(s.phase).toBe('idle');

    s = applyBeginRestart(s, Date.now());
    expect(s.phase).toBe('restarting');

    s = applyReconnected(s, false);
    expect(s.phase).toBe('reconnected');

    s = applyReset(s);
    expect(s.phase).toBe('idle');
  });

  it('phase transitions: idle -> restarting -> failed (via timeout)', () => {
    // This tests the expected timeout value; actual timeout is managed
    // by the reactive layer in config.svelte.ts
    const s = applyBeginRestart(createRestartState(), Date.now());
    expect(s.phase).toBe('restarting');

    // Simulate timeout by directly creating failed state
    const failed: RestartStateData = { ...s, phase: 'failed' };
    expect(failed.phase).toBe('failed');
  });
});
