export interface CacheInvalidatePayload {
  tags: string[];
  keys?: string[];
  source: 'hub' | 'gateway' | 'paperclip' | 'browser' | 'site';
  sourceId: string;
  tenantId: string;
  ts: number;
}

interface Registered {
  key: string;
  tags: readonly string[];
  invalidate: () => void;
}

const registry = new Map<symbol, Registered>();

export function registerStore(r: Registered): symbol {
  const handle = Symbol(r.key);
  registry.set(handle, r);
  return handle;
}

export function unregisterStore(handle: symbol): void {
  registry.delete(handle);
}

export function dispatchCacheInvalidate(payload: CacheInvalidatePayload): void {
  const eventTags = new Set(payload.tags);
  const eventKeys = new Set(payload.keys ?? []);
  for (const r of registry.values()) {
    if (eventKeys.has(r.key)) { r.invalidate(); continue; }
    for (const t of r.tags) {
      if (eventTags.has(t)) { r.invalidate(); break; }
    }
  }
}

/** Test-only — clears the registry. */
export function __reset(): void {
  registry.clear();
}
