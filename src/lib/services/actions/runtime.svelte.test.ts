import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createActionRuntime } from './runtime.svelte';
import { defineAction } from './definition';
import { createNavigationTracker } from './navigation';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
const read = defineAction({
  id: 'test.read',
  policy: 'read',
  visibility: 'foreground',
  execute: (promise: Promise<string>) => promise,
});

describe('application action runtime', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('keeps clearing fenced across reentrant scope-change observers', async () => {
    const runtime = createActionRuntime();
    runtime.subscribe(({ type }) => {
      if (type === 'settled') runtime.setScope('nested');
    });
    runtime.subscribe(({ type }) => {
      if (type === 'settled') runtime.start(read, Promise.resolve('must not start'));
    });
    const handle = runtime.start(read, new Promise<string>(() => {}));
    runtime.setScope('outer');
    expect(await handle.result).toEqual({ status: 'cancelled' });
    expect(runtime.size).toBe(0);
    expect(runtime.foregroundPending).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    runtime.dispose();
  });

  it('replaces navigation before cancelling, preserving delayed and visible activity', async () => {
    const runtime = createActionRuntime();
    const tracker = createNavigationTracker(runtime);
    const a = deferred<void>(),
      b = deferred<void>(),
      c = deferred<void>();
    tracker.sync(a.promise);
    await vi.advanceTimersByTimeAsync(100);
    tracker.sync(b.promise);
    a.reject(new Error('superseded'));
    await vi.advanceTimersByTimeAsync(50);
    expect(runtime.indicatorVisible).toBe(true);
    expect(runtime.foregroundPending).toBe(1);
    tracker.sync(c.promise);
    tracker.sync(c.promise);
    expect(runtime.indicatorVisible).toBe(true);
    expect(runtime.foregroundPending).toBe(1);
    b.resolve();
    await Promise.resolve();
    expect(runtime.indicatorVisible).toBe(true);
    tracker.sync(null);
    expect(runtime.indicatorVisible).toBe(false);
    c.resolve();
    tracker.dispose();
    runtime.dispose();
  });

  it('does not count an already completed navigation again on an unrelated effect rerun', async () => {
    const runtime = createActionRuntime();
    const tracker = createNavigationTracker(runtime);
    const complete = Promise.resolve();
    tracker.sync(complete);
    await vi.advanceTimersByTimeAsync(1);
    expect(runtime.size).toBe(1);
    expect(runtime.foregroundPending).toBe(0);
    tracker.sync(complete);
    expect(runtime.foregroundPending).toBe(0);
    expect(runtime.size).toBe(1);
    tracker.dispose();
    runtime.dispose();
  });

  it('keeps overlapping work visible without resetting the threshold', async () => {
    const runtime = createActionRuntime();
    const a = deferred<string>(),
      b = deferred<string>();
    const first = runtime.start(read, a.promise);
    await vi.advanceTimersByTimeAsync(100);
    const second = runtime.start(read, b.promise);
    a.resolve('a');
    expect(await first.result).toEqual({ status: 'succeeded', value: 'a' });
    await vi.advanceTimersByTimeAsync(50);
    expect(runtime.foregroundPending).toBe(1);
    expect(runtime.indicatorVisible).toBe(true);
    b.resolve('b');
    await second.result;
    expect(runtime.foregroundPending).toBe(0);
    expect(runtime.indicatorVisible).toBe(false);
    runtime.dispose();
  });

  it('does not flash after fast reads or count background polling', async () => {
    const runtime = createActionRuntime();
    await runtime.run(read, Promise.resolve('fast'));
    const pending = deferred<string>();
    const background = runtime.start(
      defineAction({ ...read, visibility: 'background' }),
      pending.promise,
    );
    await vi.advanceTimersByTimeAsync(200);
    expect(runtime.indicatorVisible).toBe(false);
    expect(runtime.foregroundPending).toBe(0);
    expect(runtime.backgroundPending).toBe(1);
    background.cancel();
    expect(await background.result).toEqual({ status: 'cancelled' });
    runtime.dispose();
  });

  it('fences late rejection from a superseded read and cancellation is idempotent', async () => {
    const runtime = createActionRuntime();
    const a = deferred<string>(),
      b = deferred<string>();
    const first = runtime.start(read, a.promise);
    await Promise.resolve();
    first.cancel();
    first.cancel();
    const second = runtime.start(read, b.promise);
    a.reject(new Error('superseded navigation'));
    await vi.advanceTimersByTimeAsync(150);
    expect(await first.result).toEqual({ status: 'cancelled' });
    expect(runtime.get(first.id)?.status).toBe('cancelled');
    expect(runtime.foregroundPending).toBe(1);
    expect(runtime.indicatorVisible).toBe(true);
    second.cancel();
    runtime.dispose();
  });

  it('publishes authoritative state before signals and isolates observer errors', async () => {
    const runtime = createActionRuntime();
    const seen: string[] = [];
    runtime.subscribe(() => {
      throw new Error('broken observer');
    });
    const unsubscribe = runtime.subscribe(({ action }) => {
      expect(runtime.get(action.id)).toBe(action);
      seen.push(action.status);
    });
    const cause = new Error('network');
    const failed = await runtime.run(read, Promise.reject(cause));
    expect(failed).toEqual({ status: 'failed', error: cause });
    expect(failed.status === 'failed' && failed.error).toBe(cause);
    expect(seen).toEqual(['pending', 'failed']);
    unsubscribe();
    expect(await runtime.run(read, Promise.resolve('value'))).toEqual({
      status: 'succeeded',
      value: 'value',
    });
    expect(seen).toHaveLength(2);
    expect(runtime.foregroundPending).toBe(0);
    runtime.dispose();
  });

  it('isolates scopes and runtime instances, clearing timers and ignoring late completions', async () => {
    const runtime = createActionRuntime(),
      other = createActionRuntime();
    runtime.setScope('org-a');
    const wait = deferred<string>();
    const handle = runtime.start(read, wait.promise);
    await Promise.resolve();
    runtime.setScope('org-b');
    expect(await handle.result).toEqual({ status: 'cancelled' });
    wait.resolve('old data');
    await vi.advanceTimersByTimeAsync(200);
    expect(runtime.size).toBe(0);
    expect(other.size).toBe(0);
    expect(runtime.indicatorVisible).toBe(false);
    runtime.dispose();
    runtime.dispose();
    other.dispose();
    expect(vi.getTimerCount()).toBe(0);
    expect(() => runtime.start(read, Promise.resolve('no'))).toThrow('unavailable');
  });

  it('bounds settled history and expires it without touching active work', async () => {
    const runtime = createActionRuntime();
    const pending = runtime.start(read, new Promise<string>(() => {}));
    for (let i = 0; i < 110; i++) await runtime.run(read, Promise.resolve(String(i)));
    expect(runtime.size).toBe(101);
    expect(runtime.get(pending.id)?.status).toBe('pending');
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(runtime.size).toBe(1);
    runtime.dispose();
    expect(await pending.result).toEqual({ status: 'cancelled' });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('applies backpressure before executing and aborts read transport on disposal', async () => {
    const runtime = createActionRuntime();
    let observed: AbortSignal | undefined;
    const definition = defineAction({
      id: 'test.wait',
      policy: 'read',
      visibility: 'foreground',
      execute: (_: undefined, { signal }: { signal: AbortSignal }) => {
        observed = signal;
        return new Promise<void>(() => {});
      },
    });
    for (let i = 0; i < 128; i++) runtime.start(definition, undefined);
    await Promise.resolve();
    expect(() => runtime.start(definition, undefined)).toThrow('capacity');
    expect(observed?.aborted).toBe(false);
    runtime.dispose();
    expect(observed?.aborted).toBe(true);
    expect(runtime.foregroundPending).toBe(0);
  });
});
