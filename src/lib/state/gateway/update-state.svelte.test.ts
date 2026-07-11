/**
 * Dwell-smoothed display layer over the update-progress ratchet.
 *
 * `.svelte.test.ts` so the compiler transforms the `$state` runes. Module
 * singleton — each test resets modules and re-imports.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

async function fresh() {
  vi.resetModules();
  return await import('./update-state.svelte');
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('bumpUpdateProgress display dwell', () => {
  it('steps 70/80/90 stage-by-stage instead of jumping, truth stays live', async () => {
    const s = await fresh();
    s.setUpdateProgress({ phase: 'starting', pct: 5 });
    vi.advanceTimersByTime(s.PROGRESS_DWELL_MS + 1);

    // Three real events land within ~1s of each other.
    s.bumpUpdateProgress({ phase: 'installed', pct: 70 });
    s.bumpUpdateProgress({ phase: 'watchdog-armed', pct: 80 });
    s.bumpUpdateProgress({ phase: 'restarting', pct: 90 });

    // Truth ratchets immediately; display lags, never leads.
    expect(s.updateState.progress?.pct).toBe(90);
    expect(s.updateState.display?.pct).toBe(5);

    vi.advanceTimersByTime(1); // dwell for 5% already elapsed
    expect(s.updateState.display?.pct).toBe(70);

    vi.advanceTimersByTime(s.PROGRESS_DWELL_MS);
    expect(s.updateState.display?.pct).toBe(80);

    vi.advanceTimersByTime(s.PROGRESS_DWELL_MS);
    expect(s.updateState.display?.pct).toBe(90);
  });

  it('never displays a stage that was not received (ratchet drops regressions)', async () => {
    const s = await fresh();
    s.bumpUpdateProgress({ phase: 'installing', pct: 15 });
    s.bumpUpdateProgress({ phase: 'starting', pct: 5 }); // late/out-of-order
    expect(s.updateState.progress?.pct).toBe(15);
    vi.runAllTimers();
    expect(s.updateState.display?.pct).toBe(15);
  });

  it('same-pct refresh replaces in place without an extra dwell step', async () => {
    const s = await fresh();
    s.bumpUpdateProgress({ phase: 'installing', pct: 15 });
    s.bumpUpdateProgress({ phase: 'installing', pct: 15, detail: 'npm 42s' });
    expect(s.updateState.display?.detail).toBe('npm 42s');
    vi.runAllTimers();
    expect(s.updateState.display?.pct).toBe(15);
  });

  it('setUpdateProgress clears the queue so stale stages never replay', async () => {
    const s = await fresh();
    s.bumpUpdateProgress({ phase: 'installed', pct: 70 });
    s.bumpUpdateProgress({ phase: 'watchdog-armed', pct: 80 });
    s.setUpdateProgress(null);
    vi.runAllTimers();
    expect(s.updateState.display).toBeNull();
    expect(s.updateState.progress).toBeNull();
  });
});

describe('isUpdateRestartExpected', () => {
  it('true while install in flight, false when settled', async () => {
    const s = await fresh();
    expect(s.isUpdateRestartExpected()).toBe(false);
    s.updateState.installing = true;
    expect(s.isUpdateRestartExpected()).toBe(true);
    s.updateState.installing = false;
    s.setUpdateProgress({ phase: 'restarting', pct: 90 });
    expect(s.isUpdateRestartExpected()).toBe(true);
    s.setUpdateProgress({ phase: 'done', pct: 100 });
    expect(s.isUpdateRestartExpected()).toBe(false);
    s.setUpdateProgress(null);
    expect(s.isUpdateRestartExpected()).toBe(false);
  });
});
