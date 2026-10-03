import { describe, expect, it, vi } from 'vitest';
import { createActionRuntime } from './runtime.svelte';
import {
  MutationRejected,
  runCheckedMutation,
  runCompoundMutation,
  runTrackedCommand,
} from './mutations';

describe('checked mutation outcomes', () => {
  it('keeps a rejected request distinct from a lost response', async () => {
    await expect(
      runCheckedMutation({
        attemptId: 'test.write',
        mutate: async () => {
          throw new MutationRejected(403, 'forbidden');
        },
      }),
    ).resolves.toMatchObject({ status: 'failed' });

    await expect(
      runCheckedMutation({
        attemptId: 'test.write',
        mutate: async () => {
          throw new TypeError('network lost');
        },
      }),
    ).resolves.toMatchObject({ status: 'unknown' });
  });

  it('classifies a failed refresh after acknowledgement without replaying the write', async () => {
    const mutate = vi.fn(async () => 'saved');
    const refresh = vi.fn(async () => {
      throw new Error('route failed');
    });
    const outcome = await runCheckedMutation({
      attemptId: 'test.write',
      mutate,
      refresh,
    });
    expect(outcome.status).toBe('committed-refreshing');
    expect(mutate).toHaveBeenCalledTimes(1);
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});

describe('compound mutation outcomes', () => {
  it('retains an acknowledged primary and retries only a known-rejected follow-up', async () => {
    const primary = vi.fn(async () => ({ id: 'created' }));
    const followup = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new MutationRejected(503, 'tags unavailable'))
      .mockResolvedValueOnce(undefined);
    let repair: { id: string } | undefined;

    const first = await runCompoundMutation({
      primaryAttemptId: 'test.primary',
      primary,
      followupAttemptId: 'test.followup',
      followup,
      onPrimaryCommitted: (value) => (repair = value),
    });
    expect(first).toMatchObject({ status: 'partial', value: { primary: { id: 'created' } } });
    expect(repair).toEqual({ id: 'created' });

    const second = await runCompoundMutation({
      committed: repair,
      primaryAttemptId: 'test.primary',
      primary,
      followupAttemptId: 'test.followup',
      followup,
    });
    expect(second.status).toBe('succeeded');
    expect(primary).toHaveBeenCalledTimes(1);
    expect(followup).toHaveBeenCalledTimes(2);
  });

  it('blocks blind follow-up retry when its transport result is unknown', async () => {
    const repair = { id: 'created' };
    const primary = vi.fn(async () => repair);
    const followup = vi.fn(async () => {
      throw new TypeError('connection reset');
    });
    const outcome = await runCompoundMutation({
      committed: repair,
      primaryAttemptId: 'test.primary',
      primary,
      followupAttemptId: 'test.followup',
      followup,
    });
    expect(outcome.status).toBe('unknown');
    expect(primary).not.toHaveBeenCalled();
    expect(followup).toHaveBeenCalledTimes(1);
  });

  it('does not publish a late success after an action scope switch', async () => {
    const runtime = createActionRuntime();
    const followup = vi.fn(async () => {
      runtime.setScope('other-org');
    });
    const outcome = await runTrackedCommand(runtime, 'test.compound', (context) =>
      runCompoundMutation({
        context,
        primaryAttemptId: 'test.primary',
        primary: async () => ({ id: 'old-org' }),
        followupAttemptId: 'test.followup',
        followup,
      }),
    );
    expect(outcome.status).toBe('committed-refreshing');
    runtime.dispose();
  });
});
