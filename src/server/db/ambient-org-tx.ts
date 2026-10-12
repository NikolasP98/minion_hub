import { AsyncLocalStorage } from 'node:async_hooks';
import type { CoreTx } from './with-org-core';

/**
 * One org-scoped transaction shared by every same-scope `withOrgCore` call in
 * a request. Opened by `ambientOrgTxHandle` (src/hooks.server.ts) for POS GETs
 * only; `withOrgCore` joins it instead of paying BEGIN + set_config + COMMIT
 * per service call.
 */
export interface AmbientOrgTx {
  readonly tx: CoreTx;
  readonly tenantId: string;
  readonly profileId: string | null;
  /** A statement inside the shared transaction failed, so Postgres aborted it
   *  and every later statement on it answers 25P02. Never commit it. */
  poisoned: boolean;
  /** The shared transaction has ended (or is ending) — nothing may join it. */
  closed: boolean;
  /**
   * End the shared transaction and resolve once its pooled connection is on
   * its way back to the pool. The RLS pool holds a SINGLE connection
   * (`getRlsPgClient`), so a private transaction opened while this one is
   * still running would queue behind a transaction that is itself waiting for
   * the caller — a deadlock. Idempotent.
   *
   * TODO(handoff): that single connection also means two concurrent POS GETs
   * now serialize per REQUEST instead of per statement (same pool throughput,
   * FIFO instead of round-robin). Revisit `SUPABASE_DB_RLS_POOL_SIZE` and its
   * `Math.min(2, …)` cap in pg-pool.ts if POS concurrency grows; raising it is
   * a Supavisor client-slot decision (see the EMAXCONN note there), not a
   * local one. Open ends are listed in the `perf/debloat-d` PR body.
   */
  release(): Promise<void>;
}

/** What the owner of the shared transaction needs; callers only see the store. */
export interface AmbientOrgTxOwner {
  ambient: AmbientOrgTx;
  /** Resolves when a `withOrgCore` call asked for the transaction to end. */
  releaseRequested: Promise<void>;
  /** Owner tells waiters the transaction is finishing (commit/rollback issued). */
  markEnded(): void;
  /** Run `fn` with this transaction ambient for every `withOrgCore` inside it. */
  run<T>(fn: () => T): T;
}

const storage = new AsyncLocalStorage<AmbientOrgTx>();

export function currentAmbientOrgTx(): AmbientOrgTx | undefined {
  return storage.getStore();
}

export function createAmbientOrgTx(
  tx: CoreTx,
  tenantId: string,
  profileId: string | null,
): AmbientOrgTxOwner {
  let requestRelease!: () => void;
  const releaseRequested = new Promise<void>((resolve) => {
    requestRelease = resolve;
  });
  let markEnded!: () => void;
  const ended = new Promise<void>((resolve) => {
    markEnded = resolve;
  });
  const ambient: AmbientOrgTx = {
    tx,
    tenantId,
    profileId,
    poisoned: false,
    closed: false,
    release() {
      ambient.closed = true;
      requestRelease();
      return ended;
    },
  };
  return { ambient, releaseRequested, markEnded, run: (fn) => storage.run(ambient, fn) };
}
