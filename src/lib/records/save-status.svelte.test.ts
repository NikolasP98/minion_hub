/**
 * `createSaveStatus` only uses `$state` (no `$effect`), so it's safe to call
 * directly with no owning `$effect.root` — see settled-day.svelte.test.ts for
 * why a bare `$effect` would be a false-green trap in this harness; this
 * module has none.
 */
import { MutationRejected } from '$lib/services/actions/mutations';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
const scopeState = vi.hoisted(() => ({
  current: undefined as { scopeVersion: number } | undefined,
}));
vi.mock('$lib/services/actions/context', () => ({ tryUseActions: () => scopeState.current }));
import { createSaveStatus } from './save-status.svelte';
afterEach(() => {
  scopeState.current = undefined;
});

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
      if (attempt === 1) throw new MutationRejected(422, 'boom');
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

describe('truthful save recovery', () => {
  it('never replays a lost response even when a read happens to match the draft', async () => {
    const s = createSaveStatus();
    const write = vi.fn(async () => {
      throw new TypeError('connection lost');
    });
    await expect(s.run(write)).rejects.toThrow('connection lost');
    expect(s.status).toBe('unknown');
    // A matching projection may have been written by another actor.
    const read = vi.fn(async () => 'desired value');
    expect(await read()).toBe('desired value');
    await s.retry();
    expect(s.status).toBe('unknown');
    expect(write).toHaveBeenCalledTimes(1);
  });
  it('preserves conflict and never lets Retry overwrite it', async () => {
    const s = createSaveStatus();
    const write = vi.fn(async () => {
      throw new MutationRejected(409, 'stale');
    });
    await expect(s.run(write)).rejects.toThrow('stale');
    await s.retry();
    expect(s.status).toBe('conflict');
    expect(write).toHaveBeenCalledTimes(1);
  });
  it('repairs only the projection after acknowledgement', async () => {
    const { saveAndRefresh } = await import('./save-status.svelte');
    const s = createSaveStatus();
    const write = vi.fn(async () => undefined);
    const refresh = vi
      .fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue(undefined);
    await expect(s.run(() => saveAndRefresh(write, refresh))).rejects.toThrow('offline');
    expect(s.status).toBe('committed-refreshing');
    await s.retry();
    expect(write).toHaveBeenCalledTimes(1);
    expect(refresh).toHaveBeenCalledTimes(2);
    expect(s.status).toBe('saved');
  });
  it('retires a queued write when the preceding operation is uncertain', async () => {
    const s = createSaveStatus();
    let reject!: (error: Error) => void;
    const first = s
      .run(
        () =>
          new Promise<void>((_, r) => {
            reject = r;
          }),
      )
      .catch(() => {});
    const secondWriter = vi.fn(async () => undefined);
    const second = s.run(secondWriter).catch(() => {});
    await Promise.resolve();
    reject(new TypeError('lost'));
    await Promise.all([first, second]);
    expect(secondWriter).not.toHaveBeenCalled();
    expect(s.status).toBe('unknown');
  });
  it('does not repair the previous identity after scope rotation', async () => {
    const { saveAndRefresh } = await import('./save-status.svelte');
    const s = createSaveStatus();
    let owner = 'a';
    const refresh = vi.fn().mockRejectedValue(new Error('offline'));
    await expect(
      s.run(
        () =>
          saveAndRefresh(
            async () => undefined,
            refresh,
            () => owner === 'a',
          ),
        { isCurrent: () => owner === 'a' },
      ),
    ).rejects.toThrow();
    owner = 'b';
    await s.retry();
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});
it('does not restore a write retry after its next attempt becomes a conflict', async () => {
  const s = createSaveStatus();
  let count = 0;
  const write = vi.fn(async () => {
    throw new MutationRejected(++count === 1 ? 422 : 409, 'rejected');
  });
  await expect(s.run(write)).rejects.toThrow();
  await s.retry();
  await s.retry();
  expect(s.status).toBe('conflict');
  expect(write).toHaveBeenCalledTimes(2);
});

it('does not let an old read repair paint over a newer uncertain write', async () => {
  const { saveAndRefresh } = await import('./save-status.svelte');
  const status = createSaveStatus();
  let finish!: () => void;
  const refresh = vi
    .fn()
    .mockRejectedValueOnce(new Error('offline'))
    .mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
  await expect(status.run(() => saveAndRefresh(async () => undefined, refresh))).rejects.toThrow();
  const repair = status.retry();
  await expect(
    status.run(async () => {
      throw new TypeError('lost');
    }),
  ).rejects.toThrow();
  finish();
  await repair;
  expect(status.status).toBe('unknown');
});

it('hides the retired runtime indicator and fences its response and retry', async () => {
  const runtime = { scopeVersion: 1 };
  scopeState.current = runtime;
  const status = createSaveStatus();
  let finish!: () => void;
  const writer = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  const pending = status.run(writer);
  await Promise.resolve();
  runtime.scopeVersion++;
  expect(status.status).toBe('idle');
  expect(status.canRetry).toBe(false);
  finish();
  await expect(pending).rejects.toThrow('Editing context changed');
  await status.retry();
  expect(writer).toHaveBeenCalledTimes(1);
  await status.run(async () => undefined);
  expect(status.status).toBe('saved');
});
