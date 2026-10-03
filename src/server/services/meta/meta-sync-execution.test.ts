import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MetaSyncJob } from '$server/db/pg-meta-schema';
import type { MetaJobLease } from './meta-sync-jobs.service';

const pool = vi.hoisted(() => ({
  query: null as (Promise<unknown> & { cancel: () => void | Promise<void> }) | null,
}));

vi.mock('$server/db/pg-pool', () => ({
  getPgClient: () => () => pool.query,
}));

import {
  META_SYNC_HEARTBEAT_MS,
  META_SYNC_RENEW_DRAIN_MS,
  META_SYNC_RENEW_WATCHDOG_MS,
  renewMetaJobLease,
  startMetaJobExecution,
} from './meta-sync-execution';

const lease: MetaJobLease = {
  jobId: '11111111-1111-4111-8111-111111111111',
  orgId: '22222222-2222-4222-8222-222222222222',
  ownerId: '33333333-3333-4333-8333-333333333333',
  generation: 7,
};

const job = {
  id: lease.jobId,
  orgId: lease.orgId,
  status: 'running',
  leaseOwner: lease.ownerId,
  leaseGeneration: lease.generation,
} as MetaSyncJob;

describe('Meta sync heartbeat', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    pool.query = null;
    vi.useRealTimers();
  });

  it('cancels only its owned renewal query while it is pending acquisition', async () => {
    let reject!: (error: unknown) => void;
    const pending = new Promise<unknown>((_, rejectPromise) => {
      reject = rejectPromise;
    });
    const cancel = vi.fn(() => reject(new Error('cancelled while queued')));
    pool.query = Object.assign(pending, { cancel });

    const renewal = renewMetaJobLease(lease).catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(META_SYNC_RENEW_WATCHDOG_MS);

    expect(cancel).toHaveBeenCalledOnce();
    await expect(renewal).resolves.toEqual(
      expect.objectContaining({ message: 'cancelled while queued' }),
    );
  });

  it('fails closed at the watchdog even when cancellation rejects and the query remains pending', async () => {
    let rejectQuery!: (error: unknown) => void;
    const pending = new Promise<unknown>((_, rejectPromise) => {
      rejectQuery = rejectPromise;
    });
    const cancel = vi.fn(() => Promise.reject(new Error('cancel transport failed')));
    pool.query = Object.assign(pending, { cancel });

    const renewal = renewMetaJobLease(lease).catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(META_SYNC_RENEW_WATCHDOG_MS);

    expect(cancel).toHaveBeenCalledOnce();
    await expect(renewal).resolves.toEqual(
      expect.objectContaining({ message: 'Meta sync lease renewal watchdog expired' }),
    );

    // The timed-out query can reject later without becoming unhandled.
    rejectQuery(new Error('late query rejection'));
    await Promise.resolve();
  });

  it('bounds cleanup while observing a late renewal rejection', async () => {
    let reject!: (error: unknown) => void;
    const renewal = new Promise<boolean>((_, rejectPromise) => {
      reject = rejectPromise;
    });
    const execution = startMetaJobExecution(
      { db: {} as never, tenantId: lease.orgId },
      job,
      lease,
      () => renewal,
    );

    await vi.advanceTimersByTimeAsync(META_SYNC_HEARTBEAT_MS);
    const stopping = execution.stop();
    await vi.advanceTimersByTimeAsync(META_SYNC_RENEW_DRAIN_MS);
    await expect(stopping).resolves.toBeUndefined();
    expect(execution.signal.aborted).toBe(true);

    reject(new Error('late database rejection'));
    await vi.runAllTimersAsync();
    expect(execution.signal.aborted).toBe(true);
  });
});
