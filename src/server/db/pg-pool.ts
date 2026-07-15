import postgres from 'postgres';
import { env } from '$env/dynamic/private';
import { dev } from '$app/environment';

type PgClient = ReturnType<typeof postgres>;

interface PgPoolState {
  url: string;
  client: PgClient;
}

declare global {
  // SvelteKit can evaluate server modules more than once during HMR and a
  // serverless isolate can load separate route chunks. Keep the physical pool
  // on globalThis so all Drizzle wrappers in one process share it.
  var __minionHubPgPool: PgPoolState | undefined;
  var __minionHubPgCriticalPool: PgPoolState | undefined;
  var __minionHubPgRlsPool: PgPoolState | undefined;
  var __minionHubPgPoolReset: Promise<void> | undefined;
}

// 5 preserves the long-running prod default (master e06e9263). A size-1 pool
// serializes every query behind one remote connection and times out the app
// shell against a remote DB; wedged-pipeline stalls are handled by
// resetAllPgPools rather than by serializing everything.
const DEFAULT_POOL_SIZE = 5;
const MAX_POOL_SIZE = 10;

function poolSize(): number {
  const configured = Number.parseInt(env.SUPABASE_DB_POOL_SIZE ?? '', 10);
  if (!Number.isFinite(configured)) return DEFAULT_POOL_SIZE;
  return Math.min(MAX_POOL_SIZE, Math.max(1, configured));
}

function databaseUrl(): string {
  const url = env.SUPABASE_DB_URL?.trim();
  if (!url) throw new Error('SUPABASE_DB_URL is required for the PG client');
  return url;
}

/**
 * One bounded postgres-js pool per Hub process.
 *
 * A short idle timeout and finite connection lifetime keep dev reloads and
 * retired serverless isolates from holding Supabase connections indefinitely.
 * Size via SUPABASE_DB_POOL_SIZE: higher for local dev against a remote DB,
 * small on serverless where each isolate opens its own pool.
 */
export function getPgClient(): PgClient {
  const url = databaseUrl();
  const existing = globalThis.__minionHubPgPool;
  if (existing?.url === url) return existing.client;

  if (existing) {
    void existing.client.end({ timeout: 5 }).catch((err: unknown) => {
      console.warn('[pg-pool] failed to close replaced pool', err);
    });
  }

  const client = postgres(url, {
    prepare: false,
    max: poolSize(),
    idle_timeout: 20,
    connect_timeout: 10,
    max_lifetime: 10 * 60,
  });
  globalThis.__minionHubPgPool = { url, client };
  return client;
}

/**
 * Dev-only isolation for the authenticated app shell's critical reads.
 * Route-capture/test bursts can fill the general pool with transactional child
 * page work; a small separate pool keeps navigation from becoming a blank 500.
 * Production reuses the one bounded pool to preserve serverless connection
 * budgets.
 */
export function getCriticalPgClient(): PgClient {
  if (!dev) return getPgClient();

  const url = databaseUrl();
  const existing = globalThis.__minionHubPgCriticalPool;
  if (existing?.url === url) return existing.client;

  if (existing) {
    void existing.client.end({ timeout: 5 }).catch((err: unknown) => {
      console.warn('[pg-pool] failed to close replaced critical pool', err);
    });
  }

  const client = postgres(url, {
    prepare: false,
    // ponytail: max 1 serialized all app-shell gates behind one remote conn
    // (~500ms/query × 5 parallel layout gates → 20s CoreDbOperationTimeout).
    max: Math.min(4, poolSize()),
    idle_timeout: 20,
    connect_timeout: 10,
    max_lifetime: 10 * 60,
  });
  globalThis.__minionHubPgCriticalPool = { url, client };
  return client;
}

/**
 * Transactions that apply SET LOCAL role/GUC state must not share a
 * postgres-js client with ordinary pipelined queries when using Supabase's
 * transaction pooler. Mixing both workloads can strand the client queue after
 * PgBouncer moves statements between backends. A transaction-only pool keeps
 * the reserved-connection protocol coherent.
 */
export function getRlsPgClient(): PgClient {
  const url = databaseUrl();
  const existing = globalThis.__minionHubPgRlsPool;
  if (existing?.url === url) return existing.client;

  if (existing) {
    void existing.client.end({ timeout: 5 }).catch((err: unknown) => {
      console.warn('[pg-pool] failed to close replaced RLS pool', err);
    });
  }

  const configured = Number.parseInt(env.SUPABASE_DB_RLS_POOL_SIZE ?? '', 10);
  const max = Number.isFinite(configured) ? Math.min(5, Math.max(1, configured)) : 1;
  const client = postgres(url, {
    prepare: false,
    max,
    idle_timeout: 20,
    connect_timeout: 10,
    max_lifetime: 10 * 60,
  });
  globalThis.__minionHubPgRlsPool = { url, client };
  return client;
}

/**
 * Immediately destroy a pool whose established connections stopped making
 * progress. Pending queries reject, and the next getPgClient() creates a clean
 * pool. Concurrent recovery attempts share one teardown.
 */
/**
 * Destroy every pool (general + critical + RLS) after a non-progressing
 * saturation event. Stranded pooler connections wedge a postgres-js client
 * permanently; without this a single saturation burst leaves every later
 * request timing out until the process restarts.
 */
export async function resetAllPgPools(): Promise<void> {
  const extras = [globalThis.__minionHubPgCriticalPool, globalThis.__minionHubPgRlsPool];
  delete globalThis.__minionHubPgCriticalPool;
  delete globalThis.__minionHubPgRlsPool;
  await Promise.allSettled([
    ...extras.filter((p) => p !== undefined).map((p) => p.client.end({ timeout: 0 })),
    resetPgClient(),
  ]);
}

export async function resetPgClient(expectedClient?: PgClient): Promise<void> {
  if (globalThis.__minionHubPgPoolReset) return globalThis.__minionHubPgPoolReset;

  const existing = globalThis.__minionHubPgPool;
  if (!existing) return;
  // A timeout belongs to the pool generation on which its operation began.
  // Another request may already have replaced that pool while this request was
  // unwinding. Never let a stale timeout destroy the healthy replacement.
  if (expectedClient && existing.client !== expectedClient) return;
  delete globalThis.__minionHubPgPool;
  const reset = existing.client.end({ timeout: 0 }).then(() => undefined);
  globalThis.__minionHubPgPoolReset = reset;
  try {
    await reset;
  } finally {
    if (globalThis.__minionHubPgPoolReset === reset) {
      delete globalThis.__minionHubPgPoolReset;
    }
  }
}
