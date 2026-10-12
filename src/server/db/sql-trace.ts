import { AsyncLocalStorage } from 'node:async_hooks';
import { env } from '$env/dynamic/private';

interface SqlTraceState {
  route: string;
  count: number;
  /** Queries actually written to a connection — BEGIN/COMMIT/ROLLBACK and the
   *  transaction-setup SELECT included, which the Drizzle logger never sees. */
  roundTrips: number;
  transactions: number;
  start: number;
}

const sqlTraceStorage = new AsyncLocalStorage<SqlTraceState>();

/** Opt-in only (perf debloat measurement, brief-debloat-b §1). Dev-only cost. */
export function sqlTraceEnabled(): boolean {
  return env.HUB_SQL_TRACE === '1';
}

/** Drizzle logger hook target — a no-op outside an active trace. */
export function recordSqlStatement(): void {
  const state = sqlTraceStorage.getStore();
  if (state) state.count += 1;
}

/** postgres.js `debug` hook target — one call per query put on the wire. */
export function recordSqlRoundTrip(query: string): void {
  const state = sqlTraceStorage.getStore();
  if (!state) return;
  state.roundTrips += 1;
  if (/^\s*begin\b/i.test(query)) state.transactions += 1;
}

/**
 * Wrap one request in a statement counter, logging `route · N statements · M ms`
 * when it completes. Skips the AsyncLocalStorage.run entirely when
 * HUB_SQL_TRACE is unset, so the hot path is unchanged in production.
 */
export async function runWithSqlTrace<T>(route: string, fn: () => Promise<T>): Promise<T> {
  if (!sqlTraceEnabled()) return fn();
  const state: SqlTraceState = {
    route,
    count: 0,
    roundTrips: 0,
    transactions: 0,
    start: performance.now(),
  };
  try {
    return await sqlTraceStorage.run(state, fn);
  } finally {
    const ms = Math.round(performance.now() - state.start);
    console.log(
      `[sql-trace] ${route} · ${state.count} statements · ${state.roundTrips} round trips · ${state.transactions} transactions · ${ms}ms`,
    );
  }
}
