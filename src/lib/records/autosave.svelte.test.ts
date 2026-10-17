/**
 * `createAutosave` uses `$state` only (no `$effect`), so like save-status it
 * runs without an `$effect.root`. `onDestroy`/`tryUseActions` are wrapped for
 * the no-component case.
 */
import { MutationRejected } from '$lib/services/actions/mutations';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createAutosave } from './autosave.svelte';
import { createActionRuntime } from '$lib/services/actions/runtime.svelte';

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
        throw new MutationRejected(422, 'boom');
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
      if (fail) throw new MutationRejected(422, 'boom');
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

  it('runs through the action runtime as an optimistic command: a failed save never needs attention', async () => {
    const actions = createActionRuntime();
    const f = createAutosave({
      committed: () => 'old',
      save: async () => {
        throw new MutationRejected(422, 'boom');
      },
      actions,
    });
    f.value = 'new';
    await f.flush();
    expect(f.value).toBe('old');
    expect(f.message).toBe('boom');
    expect(actions.attentionRequired).toBe(0);
    expect(actions.foregroundPending).toBe(0);
    actions.dispose();
  });
});

describe('autosave operation ownership', () => {
  it('discards a scheduled draft when selection changes before dispatch', async () => {
    let selected = 'a';
    const write = vi.fn(async (_id: string, _value: string) => undefined);
    const f = createAutosave({
      committed: () => '',
      scope: () => selected,
      prepare: (value) => {
        const id = selected;
        return () => write(id, value);
      },
    });
    f.value = 'draft';
    selected = 'b';
    await f.flush();
    expect(write).not.toHaveBeenCalled();
    expect(f.value).toBe('');
  });
  it('never adopts an old response or replays queued edits after uncertainty', async () => {
    let reject!: (error: Error) => void;
    const write = vi.fn(
      () =>
        new Promise<void>((_, r) => {
          reject = r;
        }),
    );
    const f = createAutosave({ committed: () => '', save: write, debounceMs: 0 });
    f.value = 'first';
    await Promise.resolve();
    await Promise.resolve();
    f.value = 'second';
    reject(new TypeError('lost'));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(write).toHaveBeenCalledTimes(1);
    expect(f.status).toBe('unknown');
    await f.retry();
    await f.flush();
    expect(write).toHaveBeenCalledTimes(1);
  });
  it('captures writer identity and fences its completion', async () => {
    let selected = 'a';
    let release!: () => void;
    const effects: string[] = [];
    const f = createAutosave({
      committed: () => '',
      scope: () => selected,
      prepare: (value, current) => {
        const id = selected;
        return async () => {
          await new Promise<void>((r) => {
            release = r;
          });
          if (current()) effects.push(`${id}:${value}`);
        };
      },
    });
    f.value = 'draft';
    const pending = f.flush();
    await Promise.resolve();
    await Promise.resolve();
    selected = 'b';
    release();
    await pending;
    expect(effects).toEqual([]);
    expect(f.value).toBe('');
  });
});
it('adopts an acknowledged value while refresh repair stays read-only', async () => {
  const { saveAndRefresh } = await import('./save-status.svelte');
  let committed = 'old';
  const write = vi.fn(async () => undefined);
  const refresh = vi
    .fn()
    .mockRejectedValueOnce(new Error('offline'))
    .mockImplementation(async () => {
      committed = 'newer server value';
    });
  const f = createAutosave({
    committed: () => committed,
    save: () => saveAndRefresh(write, refresh),
  });
  f.value = 'draft';
  await f.flush();
  expect(f.value).toBe('draft');
  expect(f.status).toBe('committed-refreshing');
  await f.retry();
  expect(f.value).toBe('newer server value');
  expect(write).toHaveBeenCalledTimes(1);
});

it('does not retire a new record draft when the previous response fails', async () => {
  let owner = 'a';
  let fail!: (reason: Error) => void;
  const calls: string[] = [];
  const field = createAutosave({
    committed: () => '',
    scope: () => owner,
    prepare: () => {
      const id = owner;
      return async () => {
        calls.push(id);
        if (id === 'a')
          await new Promise<void>((_resolve, reject) => {
            fail = reject;
          });
      };
    },
  });
  field.set('old record');
  const old = field.flush();
  await Promise.resolve();
  owner = 'b';
  field.set('new record');
  fail(new TypeError('old response lost'));
  await old;
  await vi.waitFor(() => expect(calls).toEqual(['a', 'b']));
  expect(field.value).toBe('new record');
});
