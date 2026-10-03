// @vitest-environment happy-dom
/**
 * The rune-backed wrappers are mounted in real Svelte owners. Every assertion
 * remains in the Vitest body so an unexecuted lifecycle callback fails the
 * owner canary instead of passing vacuously.
 */
import { cleanup, render } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createKeyedDebouncer } from './index.svelte';
import DebouncerHarness from './__fixtures__/DebouncerHarness.svelte';
import AsyncDebouncerHarness from './__fixtures__/AsyncDebouncerHarness.svelte';

type DebouncerHandle = {
  run(value: string): unknown;
  cancel(): void;
  flush(): void;
  readonly isPending: boolean;
};

type AsyncDebouncerHandle = {
  run(value: string): Promise<unknown>;
  cancel(): void;
  abort(): void;
  flush(): void;
  readonly isPending: boolean;
  readonly isExecuting: boolean;
};

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

async function mountDebouncer(
  fn: (value: string) => void,
  wait: number,
): Promise<DebouncerHandle> {
  let debouncer: DebouncerHandle | undefined;
  let ownedEffects = 0;
  render(DebouncerHarness, {
    props: {
      fn,
      wait,
      onReady: (value) => {
        debouncer = value;
      },
      onOwnedEffect: () => {
        ownedEffects += 1;
      },
    },
  });
  await tick();
  expect(ownedEffects, 'mounted debouncer owner effect did not execute').toBe(1);
  expect(debouncer, 'mounted owner did not expose the debouncer').toBeDefined();
  return debouncer!;
}

async function mountAsyncDebouncer(
  fn: (value: string) => Promise<string>,
  wait: number,
): Promise<AsyncDebouncerHandle> {
  let debouncer: AsyncDebouncerHandle | undefined;
  let ownedEffects = 0;
  render(AsyncDebouncerHarness, {
    props: {
      fn,
      wait,
      onReady: (value) => {
        debouncer = value;
      },
      onOwnedEffect: () => {
        ownedEffects += 1;
      },
    },
  });
  await tick();
  expect(ownedEffects, 'mounted async debouncer owner effect did not execute').toBe(1);
  expect(debouncer, 'mounted owner did not expose the async debouncer').toBeDefined();
  return debouncer!;
}

describe('createDebouncer', () => {
  it('runs the mounted owner canary and mirrors pending state', async () => {
    vi.useFakeTimers();
    const debouncer = await mountDebouncer(vi.fn(), 500);
    expect(debouncer.isPending).toBe(false);
    debouncer.run('value');
    await tick();
    expect(debouncer.isPending).toBe(true);
    debouncer.cancel();
    await tick();
    expect(debouncer.isPending).toBe(false);
  });

  it('fires once after the wait, latest call wins, flush and cancel work', async () => {
    vi.useFakeTimers();
    const save = vi.fn();
    const debouncer = await mountDebouncer(save, 500);

    debouncer.run('a');
    await vi.advanceTimersByTimeAsync(200);
    debouncer.run('b');
    await vi.advanceTimersByTimeAsync(499);
    expect(save).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith('b');

    debouncer.run('c');
    debouncer.flush();
    expect(save).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenLastCalledWith('c');

    debouncer.run('d');
    debouncer.cancel();
    await vi.advanceTimersByTimeAsync(1000);
    expect(save).toHaveBeenCalledTimes(2);
  });
});

describe('createAsyncDebouncer', () => {
  it('collapses a burst into one execution with the latest args', async () => {
    vi.useFakeTimers();
    const fn = vi.fn(async (term: string) => term);
    const debouncer = await mountAsyncDebouncer(fn, 10);

    void debouncer.run('a');
    void debouncer.run('b');
    const last = debouncer.run('c');
    await vi.advanceTimersByTimeAsync(10);
    await last;

    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith('c');
    expect(debouncer.isPending).toBe(false);
    expect(debouncer.isExecuting).toBe(false);
  });
});

describe('createKeyedDebouncer', () => {
  it('debounces independently per key', () => {
    vi.useFakeTimers();
    const calls: string[] = [];
    const keyed = createKeyedDebouncer<() => void>((key) => () => calls.push(key), { wait: 100 });

    keyed.run('note-1');
    keyed.run('note-2');
    vi.advanceTimersByTime(100);
    expect(calls.sort()).toEqual(['note-1', 'note-2']);

    keyed.run('note-1');
    keyed.flushAll();
    expect(calls).toEqual(['note-1', 'note-2', 'note-1']);
  });
});
