import { and, eq, sql } from 'drizzle-orm';
import { getPgClient } from '$server/db/pg-pool';
import { withOrgCore, type CoreTx } from '$server/db/with-org-core';
import type { CoreCtx } from '$server/auth/core-ctx';
import { metaSyncJobs, type MetaSyncJob } from '$server/db/pg-meta-schema';
import { META_SYNC_LEASE_SECONDS, type MetaJobLease } from './meta-sync-jobs.service';

export const META_SYNC_HEARTBEAT_MS = 30_000;
export const META_SYNC_RENEW_WATCHDOG_MS = 6_000;
export const META_SYNC_RENEW_DRAIN_MS = 11_000;

export class MetaOwnershipLostError extends Error {
  constructor() {
    super('Meta sync job ownership lost');
    this.name = 'MetaOwnershipLostError';
  }
}

export function isMetaOwnershipLost(error: unknown): boolean {
  return error instanceof MetaOwnershipLostError;
}

/**
 * One cancellable query. postgres-js removes a queued query synchronously and
 * sends CancelRequest only for this active query; it never resets a shared pool.
 */
export async function renewMetaJobLease(lease: MetaJobLease): Promise<boolean> {
  const query = getPgClient()<Array<{ renewed: boolean }>>`
    select meta_sync_renew_lease(
      ${lease.jobId}::uuid,
      ${lease.orgId}::text,
      ${lease.ownerId}::uuid,
      ${lease.generation}::integer,
      ${META_SYNC_LEASE_SECONDS}::integer
    ) as renewed
  `;
  const queryResult = Promise.resolve(query);
  let watchdog!: ReturnType<typeof setTimeout>;
  const watchdogExpired = new Promise<never>((_, reject) => {
    watchdog = setTimeout(() => {
      try {
        // Cancellation can itself reject (for example while opening the cancel
        // connection). Observe it independently; authority still fails closed
        // at the watchdog boundary even if the underlying query stays pending.
        void Promise.resolve(query.cancel()).catch(() => undefined);
      } catch {
        // A synchronous cancellation failure has the same fail-closed result.
      }
      reject(new Error('Meta sync lease renewal watchdog expired'));
    }, META_SYNC_RENEW_WATCHDOG_MS);
    watchdog.unref?.();
  });
  try {
    // Promise.race attaches a rejection observer to the query, so a late driver
    // rejection after timeout cannot become an unhandled process rejection.
    const rows = await Promise.race([queryResult, watchdogExpired]);
    return rows[0]?.renewed === true;
  } finally {
    clearTimeout(watchdog);
  }
}

export type MetaJobExecution = Readonly<{
  job: MetaSyncJob;
  lease: MetaJobLease;
  signal: AbortSignal;
  /** Short database-only transaction. Never hold this across provider I/O. */
  withOwnership: <T>(operation: (tx: CoreTx, current: MetaSyncJob) => Promise<T>) => Promise<T>;
  stop: () => Promise<void>;
}>;

function currentLeaseWhere(lease: MetaJobLease) {
  return and(
    eq(metaSyncJobs.id, lease.jobId),
    eq(metaSyncJobs.orgId, lease.orgId),
    eq(metaSyncJobs.status, 'running'),
    eq(metaSyncJobs.leaseOwner, lease.ownerId),
    eq(metaSyncJobs.leaseGeneration, lease.generation),
    sql`${metaSyncJobs.leaseExpiresAt} > clock_timestamp()`,
  );
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref?.();
  });
}

/** Start the heartbeat immediately after a successful atomic claim. */
export function startMetaJobExecution(
  ctx: CoreCtx,
  job: MetaSyncJob,
  lease: MetaJobLease,
  renew: (lease: MetaJobLease) => Promise<boolean> = renewMetaJobLease,
): MetaJobExecution {
  if (ctx.tenantId !== lease.orgId || job.id !== lease.jobId) throw new MetaOwnershipLostError();

  const abort = new AbortController();
  let stopped = false;
  let pending: Promise<void> | null = null;

  const pulse = () => {
    if (stopped || pending) return;
    pending = renew(lease)
      .then((owned) => {
        if (!owned) abort.abort();
      })
      .catch(() => {
        // A failed renewal cannot establish authority. Fail closed.
        abort.abort();
      })
      .finally(() => {
        pending = null;
      });
  };

  const timer = setInterval(pulse, META_SYNC_HEARTBEAT_MS);
  timer.unref?.();

  const withOwnership: MetaJobExecution['withOwnership'] = async (operation) => {
    if (abort.signal.aborted) throw new MetaOwnershipLostError();
    try {
      return await withOrgCore(ctx, async (tx) => {
        const [current] = await tx
          .select()
          .from(metaSyncJobs)
          .where(currentLeaseWhere(lease))
          .for('update');
        if (!current || abort.signal.aborted) throw new MetaOwnershipLostError();

        const value = await operation(tx, current);

        // Re-read database time after the operation. clock_timestamp() advances
        // while this transaction waits or executes; now() would not.
        const [stillOwned] = await tx
          .select({ id: metaSyncJobs.id })
          .from(metaSyncJobs)
          .where(currentLeaseWhere(lease))
          .limit(1);
        if (!stillOwned || abort.signal.aborted) throw new MetaOwnershipLostError();
        return value;
      });
    } catch (error) {
      if (error instanceof MetaOwnershipLostError || abort.signal.aborted) {
        abort.abort();
        throw new MetaOwnershipLostError();
      }
      throw error;
    }
  };

  return {
    job,
    lease,
    signal: abort.signal,
    withOwnership,
    stop: async () => {
      stopped = true;
      clearInterval(timer);
      const inflight = pending;
      if (!inflight) return;
      const drained = await Promise.race([
        inflight.then(() => true),
        wait(META_SYNC_RENEW_DRAIN_MS).then(() => false),
      ]);
      if (!drained) abort.abort();
    },
  };
}
