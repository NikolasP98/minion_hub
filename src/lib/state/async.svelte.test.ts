/**
 * Unit tests for the async state helpers.
 *
 * `createAutoSave` and `createConnectedFetch` are pure (no runes) and tested
 * directly. `createAsyncResource` holds `$state`, so its reads happen inside an
 * `$effect.root` with `flushSync` to materialise reactive updates.
 *
 * This file is `.svelte.test.ts` so the Svelte compiler transforms the rune
 * usage in the helper module and here.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { flushSync } from 'svelte';
import {
  createAsyncResource,
  createAutoSave,
  createConnectedFetch,
  messageError,
} from './async.svelte';

/**
 * Run an async body inside an `$effect.root` scope (so `$state` reads/writes
 * work), awaiting it before tearing the scope down.
 */
async function withRoot(fn: () => Promise<void> | void): Promise<void> {
  let result: Promise<void> | void = undefined;
  const cleanup = $effect.root(() => {
    result = fn();
  });
  try {
    await result;
  } finally {
    cleanup();
  }
}

// ── createAutoSave ──────────────────────────────────────────────────────────

describe('createAutoSave', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('fires save once after the delay', () => {
    const save = vi.fn();
    const a = createAutoSave(save, 2000);
    a.schedule();
    expect(save).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1999);
    expect(save).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('debounces: the latest schedule wins, save fires once', () => {
    const save = vi.fn();
    const a = createAutoSave(save, 2000);
    a.schedule();
    vi.advanceTimersByTime(1000);
    a.schedule(); // resets timer
    vi.advanceTimersByTime(1000);
    expect(save).not.toHaveBeenCalled(); // only 1000ms since last schedule
    vi.advanceTimersByTime(1000);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('flush() cancels the timer and saves immediately', () => {
    const save = vi.fn();
    const a = createAutoSave(save, 2000);
    a.schedule();
    a.flush();
    expect(save).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(5000);
    expect(save).toHaveBeenCalledTimes(1); // timer was cancelled
  });

  it('cancel() prevents a pending save', () => {
    const save = vi.fn();
    const a = createAutoSave(save, 2000);
    a.schedule();
    a.cancel();
    vi.advanceTimersByTime(5000);
    expect(save).not.toHaveBeenCalled();
  });

  it('respects a custom delay per instance', () => {
    const save = vi.fn();
    const a = createAutoSave(save, 800);
    a.schedule();
    vi.advanceTimersByTime(800);
    expect(save).toHaveBeenCalledTimes(1);
  });
});

// ── createConnectedFetch ────────────────────────────────────────────────────

describe('createConnectedFetch', () => {
  it('fetches once when connected, not again while still connected', () => {
    let connected = false;
    const fetchOnce = vi.fn();
    const cf = createConnectedFetch(() => connected, fetchOnce);

    cf.sync(); // disconnected
    expect(fetchOnce).not.toHaveBeenCalled();

    connected = true;
    cf.sync();
    cf.sync();
    cf.sync();
    expect(fetchOnce).toHaveBeenCalledTimes(1);
  });

  it('re-arms on disconnect and fetches again on reconnect', () => {
    let connected = true;
    const fetchOnce = vi.fn();
    const cf = createConnectedFetch(() => connected, fetchOnce);

    cf.sync();
    expect(fetchOnce).toHaveBeenCalledTimes(1);

    connected = false;
    cf.sync(); // disconnect -> re-arm
    connected = true;
    cf.sync(); // reconnect -> fetch again
    expect(fetchOnce).toHaveBeenCalledTimes(2);
  });

  it('reset() re-arms the guard manually', () => {
    let connected = true;
    const fetchOnce = vi.fn();
    const cf = createConnectedFetch(() => connected, fetchOnce);

    cf.sync();
    expect(fetchOnce).toHaveBeenCalledTimes(1);
    cf.reset();
    cf.sync();
    expect(fetchOnce).toHaveBeenCalledTimes(2);
  });
});

// ── createAsyncResource ─────────────────────────────────────────────────────

describe('createAsyncResource', () => {
  it('starts empty with default initialLoading=false', () => {
    const cleanup = $effect.root(() => {
      const r = createAsyncResource(async () => 'x');
      expect(r.data).toBeNull();
      expect(r.loading).toBe(false);
      expect(r.error).toBeNull();
    });
    cleanup();
  });

  it('honours initialLoading=true', () => {
    const cleanup = $effect.root(() => {
      const r = createAsyncResource(async () => 'x', { initialLoading: true });
      expect(r.loading).toBe(true);
    });
    cleanup();
  });

  it('transitions loading true→false and stores data on success', async () => {
    await withRoot(async () => {
      const r = createAsyncResource(async () => 'hello');
      const p = r.load();
      flushSync();
      expect(r.loading).toBe(true);
      await p;
      flushSync();
      expect(r.loading).toBe(false);
      expect(r.data).toBe('hello');
      expect(r.error).toBeNull();
    });
  });

  it('stores error via String(e) by default and clears loading', async () => {
    await withRoot(async () => {
      const r = createAsyncResource(async () => {
        throw new Error('boom');
      });
      await r.load();
      flushSync();
      expect(r.loading).toBe(false);
      expect(r.error).toBe('Error: boom'); // String(new Error('boom'))
      expect(r.data).toBeNull();
    });
  });

  it('supports a custom error formatter (messageError)', async () => {
    await withRoot(async () => {
      const r = createAsyncResource(
        async () => {
          throw new Error('boom');
        },
        { formatError: messageError },
      );
      await r.load();
      flushSync();
      expect(r.error).toBe('boom');
    });
  });

  it('clears a prior error on the next load and forwards args', async () => {
    await withRoot(async () => {
      const r = createAsyncResource(async (id: string) => `data:${id}`);
      await r.load('a');
      flushSync();
      expect(r.data).toBe('data:a');
      await r.load('b');
      flushSync();
      expect(r.data).toBe('data:b');
      expect(r.error).toBeNull();
    });
  });

  it('reset() returns to the initial empty state', async () => {
    await withRoot(async () => {
      const r = createAsyncResource(async () => 'v', { initialLoading: true });
      await r.load();
      flushSync();
      expect(r.data).toBe('v');
      r.reset();
      flushSync();
      expect(r.data).toBeNull();
      expect(r.error).toBeNull();
      expect(r.loading).toBe(true); // back to initialLoading
    });
  });
});
