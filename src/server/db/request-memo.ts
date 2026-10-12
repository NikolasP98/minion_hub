import { AsyncLocalStorage } from 'node:async_hooks';

type MemoStore = Map<string, Promise<unknown>>;

const requestMemoStorage = new AsyncLocalStorage<MemoStore>();

/**
 * Whether `src/hooks.server.ts`'s `requestMemoHandle` should activate the
 * store for this request method (brief-debloat-c §2). GET/HEAD only: a write
 * handler must always see fresh, read-after-write data, never a memoised
 * value from earlier in the same request. Exported (not inlined in the
 * handle) so the exact gate is unit-testable without booting hooks.server.ts.
 */
export function shouldActivateRequestMemo(method: string): boolean {
  return method === 'GET' || method === 'HEAD';
}

/**
 * Activates request-scoped memoisation for the lifetime of `fn`. Only
 * `src/hooks.server.ts`'s `requestMemoHandle` should call this, guarded by
 * `shouldActivateRequestMemo`.
 */
export function withRequestMemo<T>(fn: () => Promise<T>): Promise<T> {
  return requestMemoStorage.run(new Map(), fn);
}

/**
 * Memoise an idempotent read for the lifetime of the active request-memo
 * store. Outside a store (no store active — e.g. a write request, where
 * `requestMemoHandle` never ran `withRequestMemo`) this is a pure
 * passthrough: every call executes `fn` fresh, exactly like before this
 * module existed.
 *
 * A rejected promise is evicted immediately so a transient failure doesn't
 * poison a retry by the same or another caller later in the same request.
 */
export function memoRequest<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const store = requestMemoStorage.getStore();
  if (!store) return fn();
  const existing = store.get(key);
  if (existing) return existing as Promise<T>;
  const promise = fn().catch((err: unknown) => {
    store.delete(key);
    throw err;
  });
  store.set(key, promise);
  return promise;
}
