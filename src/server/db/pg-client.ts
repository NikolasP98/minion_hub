import { drizzle } from 'drizzle-orm/postgres-js';
import * as pgSchema from '@minion-stack/db/pg';
import { AsyncLocalStorage } from 'node:async_hooks';
import { getCriticalPgClient, getPgClient, getRlsPgClient, resetAllPgPools } from './pg-pool';

type PgClient = ReturnType<typeof getPgClient>;

const clientContext = new AsyncLocalStorage<PgClient>();
const MANAGED_CORE_DB = Symbol.for('minion-hub.managed-core-db');

const DEFAULT_OPERATION_TIMEOUT_MS = 10_000;

class CoreDbOperationTimeout extends Error {
  constructor(readonly timeoutMs: number) {
    super(`Core database operation timed out after ${timeoutMs}ms`);
    this.name = 'CoreDbOperationTimeout';
  }
}

const RECOVERABLE_POOL_CODES = new Set([
  'CONNECTION_DESTROYED',
  'CONNECTION_ENDED',
  'CONNECTION_CLOSED',
  'ECONNRESET',
  'EPIPE',
]);

function isRecoverablePoolError(error: unknown): boolean {
  let current = error;
  for (let depth = 0; current && depth < 5; depth += 1) {
    if (current instanceof CoreDbOperationTimeout) return true;
    if (typeof current !== 'object') return false;
    const candidate = current as { code?: unknown; cause?: unknown };
    if (typeof candidate.code === 'string' && RECOVERABLE_POOL_CODES.has(candidate.code)) {
      return true;
    }
    current = candidate.cause;
  }
  return false;
}

function isOperationTimeout(error: unknown): error is CoreDbOperationTimeout {
  return error instanceof CoreDbOperationTimeout;
}

function createDrizzle(client = clientContext.getStore() ?? getPgClient()) {
  const db = drizzle(client, { schema: pgSchema });
  Object.defineProperty(db, MANAGED_CORE_DB, { value: true });
  return db;
}

/** Singleton Drizzle-PG client. Reads/writes the relational-core tables in Supabase. */
export function getCoreDb() {
  // The wrapper is intentionally cheap and non-global. A recovery can replace
  // the physical pool without stale Drizzle singletons retaining the old one.
  return createDrizzle();
}

/** Use the transaction-only client for real Hub DB handles; preserve injected fakes in tests. */
export function getOrgTransactionDb(db: ReturnType<typeof getCoreDb>) {
  const managed = (db as typeof db & { [MANAGED_CORE_DB]?: boolean })[MANAGED_CORE_DB];
  return managed ? createDrizzle(getRlsPgClient()) : db;
}

/** Run one critical app-shell load on its dev-only isolated physical pool. */
export function withCriticalCoreDb<T>(operation: () => Promise<T>): Promise<T> {
  return clientContext.run(getCriticalPgClient(), operation);
}

function withTimeout<T>(operation: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new CoreDbOperationTimeout(timeoutMs)), timeoutMs);
  });
  return Promise.race([operation, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

/**
 * Retry one group of critical reads after replacing a non-progressing pool.
 * The retry is also bounded so callers get an explicit failure instead of an
 * indefinitely streaming SvelteKit response and blank client shell.
 */
export async function withCoreDbRecovery<T>(
  operation: () => Promise<T>,
  timeoutMs = DEFAULT_OPERATION_TIMEOUT_MS,
): Promise<T> {
  // Initialize the shared pool before invoking the callback so a synchronous
  // callback failure cannot leave its creation interleaved with recovery.
  if (!clientContext.getStore()) getPgClient();
  const initialAttempt = operation();
  try {
    return await withTimeout(initialAttempt, timeoutMs);
  } catch (error) {
    // A timeout can mean the postgres-js queue is saturated rather than that a
    // connection is dead. Keep waiting on the same attempt for one more window
    // before destroying anything. This prevents a burst of page loads from
    // turning ordinary backpressure into a pool-reset cascade.
    if (isOperationTimeout(error)) {
      console.warn(`[pg-pool] operation is slow; allowing the in-flight query a grace window`);
      try {
        return await withTimeout(initialAttempt, timeoutMs);
      } catch (graceError) {
        if (isOperationTimeout(graceError)) {
          // postgres-js cannot cancel a promise that is already queued. Keep
          // waiting on that exact attempt instead of submitting a duplicate or
          // destroying a shared pool that may be serving unrelated requests.
          console.warn(`[pg-pool] operation remains slow; continuing without replacing the pool`);
          try {
            return await withTimeout(initialAttempt, timeoutMs * 2);
          } catch (finalError) {
            if (!isOperationTimeout(finalError)) throw finalError;
            // ~4× timeoutMs with zero progress: the pool is wedged (stranded
            // pooler connections). Without a reset every later request times
            // out until the process restarts. Destroy all pools, retry once.
            console.warn(`[pg-pool] pool not progressing; resetting all pools and retrying once`);
            await resetAllPgPools();
            const fresh = clientContext.getStore()
              ? clientContext.run(getCriticalPgClient(), operation)
              : operation();
            return withTimeout(fresh, timeoutMs * 2);
          }
        }
        error = graceError;
      }
    }
    if (!isRecoverablePoolError(error)) throw error;
    // postgres-js removes a terminated physical connection from its pool and
    // opens a new one for the next query. Retry the operation on that healed
    // pool; replacing the whole client would abort healthy concurrent writes.
    console.warn(`[pg-pool] connection failed; retrying once on a fresh pool connection`);
    return withTimeout(operation(), timeoutMs * 2);
  }
}
