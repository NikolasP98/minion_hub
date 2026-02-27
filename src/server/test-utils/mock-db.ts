import { vi } from 'vitest';
import type { Db } from '$server/db/client';

/**
 * Creates a chainable Drizzle mock with configurable return values.
 *
 * ## How it works
 *
 * Drizzle queries are method chains that are thenable (awaitable):
 *   `await db.select().from(table).where(...)`
 *
 * This mock creates Proxy chains where every method returns another chain,
 * and `await`-ing any point resolves to the configured result. Top-level
 * methods (db.select, db.insert, db.delete, db.update) are cached `vi.fn()`
 * spies so you can assert on them.
 *
 * ## API
 *
 * - `resolve(value)` — set a single return value for all awaited chains
 * - `resolveSequence([v1, v2, ...])` — return v1 for the 1st await, v2 for
 *   the 2nd, etc. Useful for functions that make multiple DB calls (e.g.
 *   a join query followed by a lookup). After exhausting the sequence,
 *   subsequent awaits return `[]`.
 *
 * ## TS strictness note
 *
 * When wrapping mock fns in `vi.mock()` factories, use explicit typed
 * signatures instead of `(...args: unknown[]) => mock(...args)` — the
 * latter passes vitest but fails `svelte-check` ("spread argument must
 * have a tuple type"). Example:
 * ```ts
 * const mockFn = vi.fn<(k: string) => Promise<void>>();
 * vi.mock('module', () => ({ fn: (k: string) => mockFn(k) }));
 * ```
 *
 * @example
 *   // Single result
 *   const { db, resolve } = createMockDb();
 *   resolve([{ id: '1' }]);
 *   const rows = await listServers({ db, tenantId: 't1' });
 *
 * @example
 *   // Sequential results (multiple DB calls)
 *   const { db, resolveSequence } = createMockDb();
 *   resolveSequence([
 *     [{ userId: 'u1', email: 'a@b.com' }],  // 1st select
 *     [{ tenantId: 't1', role: 'admin' }],    // 2nd select
 *   ]);
 *   const result = await validateSession(db, token);
 */
export function createMockDb() {
  let _results: unknown[] = [];
  let _cursor = 0;
  let _sequential = false;

  function resolve(value: unknown) {
    _results = [value];
    _cursor = 0;
    _sequential = false;
  }

  function resolveSequence(values: unknown[]) {
    _results = values;
    _cursor = 0;
    _sequential = true;
  }

  function nextResult(): unknown {
    if (!_sequential) return _results[0] ?? [];
    const val = _cursor < _results.length ? _results[_cursor] : [];
    _cursor++;
    return val;
  }

  /** Creates a thenable chain proxy — every method returns another chain,
   *  and awaiting it resolves to the next result. */
  function createChain(): Record<string, unknown> {
    return new Proxy({} as Record<string, unknown>, {
      get(_target, prop) {
        // Make the chain thenable so `await chain` resolves to a result
        if (prop === 'then') {
          const result = nextResult();
          return (onFulfilled: (v: unknown) => void) => onFulfilled(result);
        }
        if (typeof prop === 'symbol') return undefined;

        // Every method call returns a new chain (also thenable)
        return vi.fn((..._args: unknown[]) => createChain());
      },
    });
  }

  const topLevelCache: Record<string, unknown> = {};

  const db = new Proxy(topLevelCache, {
    get(target, prop) {
      if (prop === 'then') return undefined; // db itself is NOT thenable
      if (typeof prop === 'symbol') return undefined;

      // Cache top-level methods so we can assert on them (e.g. db.insert)
      if (!target[prop as string]) {
        target[prop as string] = vi.fn((..._args: unknown[]) => createChain());
      }
      return target[prop as string];
    },
  }) as unknown as Db;

  return { db, resolve, resolveSequence };
}
