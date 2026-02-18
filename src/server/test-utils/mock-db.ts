import { vi } from 'vitest';
import type { Db } from '$server/db/client';

/**
 * Creates a chainable mock that records the last method call arguments
 * and resolves queries with configurable return values.
 *
 * The chain is thenable — awaiting any point in the chain resolves to
 * the configured value. Methods like `$dynamic()` return a new chain
 * that is also chainable and thenable.
 *
 * Usage:
 *   const { db, resolve } = createMockDb();
 *   resolve([{ id: '1' }]);            // next query returns this
 *   await someService({ db, tenantId: 't1' }, ...);
 *   expect(db.insert).toHaveBeenCalled();
 */
export function createMockDb() {
  let _result: unknown = [];

  function resolve(value: unknown) {
    _result = value;
  }

  /** Creates a thenable chain proxy — every method returns another chain,
   *  and awaiting it resolves to _result. */
  function createChain(): Record<string, unknown> {
    const cache: Record<string, unknown> = {};
    return new Proxy(cache, {
      get(_target, prop) {
        // Make the chain thenable so `await chain` resolves to _result
        if (prop === 'then') {
          return (resolve: (v: unknown) => void) => resolve(_result);
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

  return { db, resolve };
}
