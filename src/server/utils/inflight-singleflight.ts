declare global {
  // Keep the registry across Vite SSR module reloads. Values live only until
  // their operation settles; this is request coalescing, not a data cache.
  var __minionHubInflight: Map<string, Promise<unknown>> | undefined;
}

function registry(): Map<string, Promise<unknown>> {
  return (globalThis.__minionHubInflight ??= new Map());
}

/**
 * Share one in-flight operation among callers using the same stable key.
 * A short post-success reuse window can absorb full-page reload bursts without
 * becoming a long-lived application cache. Rejections are always evicted now.
 */
export function shareInflight<T>(
  key: string,
  factory: () => Promise<T>,
  reuseForMs = 0,
): Promise<T> {
  const inflight = registry();
  const existing = inflight.get(key);
  if (existing) return existing as Promise<T>;

  const operation = Promise.resolve().then(factory);
  inflight.set(key, operation);

  const clear = () => {
    if (inflight.get(key) === operation) inflight.delete(key);
  };
  void operation.then(() => {
    if (reuseForMs > 0) setTimeout(clear, reuseForMs);
    else clear();
  }, clear);
  return operation;
}
