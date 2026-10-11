/**
 * `createAutosave` uses `$state` only (no `$effect`), so like save-status it
 * runs without an `$effect.root`. `onDestroy`/`tryUseActions` are wrapped for
 * the no-component case.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createAutosave } from './autosave.svelte';

describe('createAutosave', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('shows intent immediately, debounces, and saves the LATEST value once', async () => {
    let committed = 'a';
    const save = vi.fn(async (v: string) => {
      committed = v;
    });
    const f = createAutosave({ committed: () => committed, save });
    f.value = 'ab';
    f.value = 'abc';
    expect(f.value).toBe('abc');
    expect(f.pending).toBe(true);
    expect(save).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(500);
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith('abc');
    expect(f.value).toBe('abc');
    expect(f.pending).toBe(false);
    expect(f.status).toBe('saved');
  });

  it('rolls back to the committed value when the write fails', async () => {
    const f = createAutosave({
      committed: () => 'old',
      save: async () => {
        throw new Error('boom');
      },
    });
    f.value = 'new';
    await f.flush();
    expect(f.value).toBe('old');
    expect(f.status).toBe('error');
    expect(f.message).toBe('boom');
  });

  it('keeps the draft on failure when asked, and retry re-sends it', async () => {
    let fail = true;
    const save = vi.fn(async () => {
      if (fail) throw new Error('boom');
    });
    const f = createAutosave({ committed: () => 'old', save, keepDraftOnError: true });
    f.value = 'new';
    await f.flush();
    expect(f.value).toBe('new');
    expect(f.status).toBe('error');
    fail = false;
    await f.retry();
    expect(save).toHaveBeenLastCalledWith('new');
    expect(f.status).toBe('saved');
    expect(f.value).toBe('new'); // acknowledged base, committed() still 'old'
  });

  it('lets a refreshed committed value override the acknowledged base', async () => {
    let committed = 'a';
    const f = createAutosave({ committed: () => committed, save: async () => {} });
    f.value = 'b';
    await f.flush();
    expect(f.value).toBe('b');
    committed = 'c'; // another view / invalidate landed
    expect(f.value).toBe('c');
  });

  it('coalesces edits made during an in-flight write into one follow-up save', async () => {
    let release!: () => void;
    const save = vi.fn(() => new Promise<void>((r) => (release = r)));
    const f = createAutosave({ committed: () => '', save, debounceMs: 0 });
    f.value = '1';
    f.value = '12';
    f.value = '123';
    await vi.advanceTimersByTimeAsync(0); // the serialized chain dispatches on a microtask
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenLastCalledWith('1');
    release();
    await vi.advanceTimersByTimeAsync(0);
    expect(save).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenLastCalledWith('123');
  });

  it('does not write when the value equals the committed one', async () => {
    const save = vi.fn(async () => {});
    const f = createAutosave({ committed: () => 'same', save, debounceMs: 0 });
    f.value = 'same';
    await f.flush();
    expect(save).not.toHaveBeenCalled();
    expect(f.pending).toBe(false);
  });
});
