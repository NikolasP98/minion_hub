/**
 * `createSaveStatus` only uses `$state` (no `$effect`), so it's safe to call
 * directly with no owning `$effect.root` — see settled-day.svelte.test.ts for
 * why a bare `$effect` would be a false-green trap in this harness; this
 * module has none.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createSaveStatus } from './save-status.svelte';

describe('createSaveStatus', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('goes saving -> saved -> idle after the reset delay', async () => {
    const s = createSaveStatus();
    expect(s.status).toBe('idle');

    const p = s.run(async () => 'ok');
    expect(s.status).toBe('saving'); // flips synchronously, not a microtask later
    await p;
    expect(s.status).toBe('saved');

    vi.advanceTimersByTime(1499);
    expect(s.status).toBe('saved');
    vi.advanceTimersByTime(1);
    expect(s.status).toBe('idle');
  });

  it('sets an error + message on failure; retry() re-runs the same fn', async () => {
    const s = createSaveStatus();
    let attempt = 0;
    const fn = vi.fn(async () => {
      attempt += 1;
      if (attempt === 1) throw new Error('boom');
      return 'ok';
    });

    await expect(s.run(fn)).rejects.toThrow('boom');
    expect(s.status).toBe('error');
    expect(s.message).toBe('boom');

    await s.retry();
    expect(fn).toHaveBeenCalledTimes(2);
    expect(s.status).toBe('saved');
  });

  it('retry() is a no-op once the status has moved past error', async () => {
    const s = createSaveStatus();
    const fn = vi.fn(async () => 'ok');
    await s.run(fn);
    expect(s.status).toBe('saved');

    await s.retry();
    expect(fn).toHaveBeenCalledTimes(1); // never re-run — status isn't 'error'
  });

  it('serializes overlapping calls (fast blur -> change -> blur never races)', async () => {
    const s = createSaveStatus();
    const order: string[] = [];
    let releaseFirst!: () => void;

    const first = s.run(
      () =>
        new Promise<void>((resolve) => {
          order.push('first-start');
          releaseFirst = () => {
            order.push('first-end');
            resolve();
          };
        }),
    );
    const second = s.run(async () => {
      order.push('second');
    });

    // `run` chains behind the previous save, so `fn` starts a microtask later.
    await vi.waitFor(() => expect(order).toContain('first-start'));
    releaseFirst();
    await first;
    await second;

    expect(order).toEqual(['first-start', 'first-end', 'second']);
  });
});
