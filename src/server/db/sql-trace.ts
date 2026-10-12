import { AsyncLocalStorage } from 'node:async_hooks';
import { env } from '$env/dynamic/private';

interface SqlTraceState {
  route: string;
  count: number;
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

/**
 * Wrap one request in a statement counter, logging `route · N statements · M ms`
 * when it completes. Skips the AsyncLocalStorage.run entirely when
 * HUB_SQL_TRACE is unset, so the hot path is unchanged in production.
 */
export async function runWithSqlTrace<T>(route: string, fn: () => Promise<T>): Promise<T> {
  if (!sqlTraceEnabled()) return fn();
  const state: SqlTraceState = { route, count: 0, start: performance.now() };
  try {
    return await sqlTraceStorage.run(state, fn);
  } finally {
    const ms = Math.round(performance.now() - state.start);
    console.log(`[sql-trace] ${route} · ${state.count} statements · ${ms}ms`);
  }
}
