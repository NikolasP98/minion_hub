import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createActionRuntime } from './runtime.svelte';
import { defineCommandAction, type CommandContext } from './definition';

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
}

describe('confirmed action lifecycle', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('keeps a committed write acknowledged when refreshing throws, without replaying it', async () => {
    const actions = createActionRuntime();
    const write = vi.fn(async () => true);
    const refresh = vi.fn(async () => {
      throw new Error('refresh unavailable');
    });
    const result = await actions.runCommand('test.save', async (ctx) => {
      await ctx.attempt('test.patch', write);
      ctx.acknowledge();
      await ctx.attempt('test.refresh', refresh);
      return { status: 'succeeded', value: 1 };
    });
    expect(result.status).toBe('committed-refreshing');
    expect(actions.foregroundPending).toBe(0);
    expect(actions.attentionRequired).toBe(1);
    expect(actions.attention[0].attempts.map((a) => a.status)).toEqual(['succeeded', 'failed']);
    expect(write).toHaveBeenCalledTimes(1);
    expect(actions.dismiss(actions.attention[0].id)).toBe(false);
    actions.dispose();
  });

  it('does not treat a lost response as a failed write or retain payloads/errors', async () => {
    const actions = createActionRuntime();
    const secret = new Error('customer-private-data');
    const result = await actions.runCommand('test.save', async () => {
      throw secret;
    });
    expect(result).toEqual({ status: 'unknown', error: secret });
    expect(actions.attentionRequired).toBe(1);
    expect(JSON.stringify(actions.attention)).not.toContain('customer-private-data');
    await vi.advanceTimersByTimeAsync(6 * 60_000);
    expect(actions.attentionRequired).toBe(1);
    expect(actions.dismiss(actions.attention[0].id)).toBe(false);
    expect(actions.reconcile(actions.attention[0].id, 'succeeded')).toBe(true);
    expect(actions.attentionRequired).toBe(0);
    actions.dispose();
  });

  it('moves accepted jobs out of the foreground without pretending they finished', async () => {
    const actions = createActionRuntime();
    const accepted = deferred<void>(),
      done = deferred<void>();
    const task = actions.runCommand('finance.sync', async (ctx) => {
      await accepted.promise;
      ctx.attachJob('durable-job-1');
      ctx.progress(2, 10);
      await done.promise;
      ctx.progress(10, 10);
      return { status: 'succeeded', value: 10 };
    });
    await vi.advanceTimersByTimeAsync(150);
    expect(actions.indicatorVisible).toBe(true);
    accepted.resolve();
    await vi.advanceTimersByTimeAsync(1);
    expect(actions.indicatorVisible).toBe(false);
    expect(actions.foregroundPending).toBe(0);
    expect(actions.backgroundJobs).toBe(1);
    expect(actions.jobs[0].progress).toEqual({ completed: 2, total: 10 });
    done.resolve();
    expect((await task).status).toBe('succeeded');
    expect(actions.backgroundJobs).toBe(0);
    actions.dispose();
  });

  it('throttles progress but preserves immediate final progress and caps attempt history', async () => {
    const actions = createActionRuntime();
    const progress: number[] = [];
    actions.subscribe((event) => {
      if (event.type === 'progress') progress.push(event.action.progress!.completed);
    });
    await actions.runCommand('test.batch', async (ctx) => {
      ctx.attachJob('job');
      for (let i = 0; i < 99; i++) ctx.progress(i, 100);
      expect(progress).toEqual([0]);
      await vi.advanceTimersByTimeAsync(100);
      expect(progress).toEqual([0, 98]);
      ctx.progress(100, 100);
      expect(progress).toEqual([0, 98, 100]);
      for (let i = 0; i < 50; i++) await ctx.attempt('batch.request', async () => i);
      return { status: 'succeeded', value: undefined };
    });
    expect(actions.get(1)?.attempts).toHaveLength(32);
    expect(actions.foregroundPending).toBe(0);
    actions.dispose();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('fences scope-disposed command observers and never represents abort as Undo', async () => {
    const actions = createActionRuntime();
    let context: CommandContext | undefined;
    const wait = deferred<void>();
    const task = actions.runCommand('test.write', async (ctx) => {
      context = ctx;
      await wait.promise;
      return { status: 'succeeded', value: undefined };
    });
    await Promise.resolve();
    actions.setScope('new-org');
    expect((await task).status).toBe('unknown');
    expect(context?.isCurrent()).toBe(false);
    expect(context?.signal.aborted).toBe(true);
    wait.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(actions.size).toBe(0);
    expect(actions.attentionRequired).toBe(0);
    actions.dispose();
  });

  it('never executes a command cancelled before dispatch', async () => {
    const actions = createActionRuntime();
    const execute = vi.fn(async () => ({ status: 'succeeded' as const, value: 0 }));
    const command = defineCommandAction({
      id: 'test.command',
      policy: 'confirmed',
      visibility: 'foreground',
      execute,
    });
    const handle = actions.start(command, undefined);
    handle.cancel();
    expect((await handle.result).status).toBe('failed');
    await Promise.resolve();
    expect(execute).not.toHaveBeenCalled();
    actions.dispose();
  });

  it('keeps explicit failures and partial results distinct; dismiss is idempotent', async () => {
    const actions = createActionRuntime();
    await actions.runCommand('test.false', async () => ({ status: 'failed' }));
    await actions.runCommand('test.partial', async () => ({
      status: 'partial',
      value: [true, false],
    }));
    expect(actions.attention.map((x) => x.status)).toEqual(['failed', 'partial']);
    const id = actions.attention[0].id;
    expect(actions.dismiss(id)).toBe(true);
    expect(actions.dismiss(id)).toBe(false);
    expect(actions.attentionRequired).toBe(1);
    actions.dispose();
  });
});

describe('command observation boundaries', () => {
  it('cannot dispatch after an attempt observer switches scope', async () => {
    const actions = createActionRuntime();
    const write = vi.fn(async () => true);
    actions.subscribe((event) => {
      if (event.type === 'attempt') actions.setScope('other-org');
    });
    const result = await actions.runCommand('test.scoped', async (ctx) => {
      await ctx.attempt('test.patch', write);
      return { status: 'succeeded', value: undefined };
    });
    expect(result.status).toBe('unknown');
    expect(write).not.toHaveBeenCalled();
    expect(actions.size).toBe(0);
    actions.dispose();
  });
  it('preserves navigation capacity even when unresolved commands saturate admission', async () => {
    const actions = createActionRuntime();
    for (let i = 0; i < 128; i++)
      await actions.runCommand('test.unresolved', async () => ({ status: 'unknown' }));
    await expect(
      actions.runCommand('test.extra', async () => ({ status: 'failed' })),
    ).rejects.toThrow('capacity');
    const { navigationAction } = await import('./navigation');
    const value = await actions.run(navigationAction, Promise.resolve());
    expect(value.status).toBe('succeeded');
    expect(actions.attentionRequired).toBe(128);
    actions.dispose();
  });
  it('keeps accepted job identity when observation fails without claiming job completion', async () => {
    const actions = createActionRuntime();
    await actions.runCommand('test.job', async (ctx) => {
      ctx.attachJob('durable');
      throw new Error('poll unavailable');
    });
    expect(actions.attention[0]).toMatchObject({ status: 'unknown', jobId: 'durable' });
    expect(actions.backgroundJobs).toBe(0);
    expect(actions.foregroundPending).toBe(0);
    actions.dispose();
  });
});
