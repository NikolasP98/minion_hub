import { sql, type SQL } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';

/**
 * Thrown by an update path when an optimistic-lock check (`expectedUpdatedAt`)
 * matched 0 rows but the row still exists — the caller had a stale copy.
 * Carries the current row so the route/UI can show what changed.
 */
export class StaleWriteError<T> extends Error {
  constructor(public readonly current: T) {
    super('stale write: record was modified since it was loaded');
    this.name = 'StaleWriteError';
  }
}

/**
 * Epoch-ms WHERE guard for optimistic locking. PG `timestamp` has microsecond
 * precision; JS `Date` has millisecond precision — comparing at ms avoids
 * false conflicts on rows whose `updatedAt` came from SQL `now()`. Returns
 * `undefined` (drizzle's `and()` drops it) when no expectation was supplied,
 * so omitting `expectedUpdatedAt` stays backward-compatible.
 */
export function staleGuard(column: AnyPgColumn, expected?: Date): SQL | undefined {
  return expected
    ? sql`floor(extract(epoch from ${column}) * 1000) = ${expected.getTime()}`
    : undefined;
}
