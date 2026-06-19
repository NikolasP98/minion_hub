import { registerStore, unregisterStore } from './cache-invalidate-listener.svelte';

export interface CachedStoreOptions<T> {
  key: string;
  tags?: string[];
  fetcher: () => Promise<T>;
  initial?: T;
  ttl?: number;
  swr?: number;
  storage?: 'session' | 'memory';
}

export interface CachedStore<T> {
  readonly data: T | null;
  readonly loading: boolean;
  readonly error: Error | null;
  readonly stale: boolean;
  readonly key: string;
  readonly tags: readonly string[];
  refresh(): Promise<void>;
  invalidate(): void;
  /**
   * Optimistically patch the in-memory `data` (e.g. before a server roundtrip).
   * The updater receives the current value (or null) and returns the next one.
   * NOT persisted to storage — the next successful `refresh()` reconciles from
   * the server, so this is the SWR-correct way to do optimistic writes without a
   * second hand-mirrored copy of the data.
   */
  mutate(updater: (current: T | null) => T): void;
  destroy(): void;
}

const STORAGE_PREFIX = 'hub:cache:v1:';
const DEFAULT_TTL = 5 * 60_000;
const DEFAULT_SWR = 60_000;

interface StoredEntry<T> {
  value: T;
  expiresAt: number;
  staleUntil: number;
}

function readStorage<T>(key: string, storage: Storage): StoredEntry<T> | null {
  try {
    const raw = storage.getItem(STORAGE_PREFIX + key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredEntry<T>;
    if (typeof parsed?.expiresAt !== 'number' || typeof parsed?.staleUntil !== 'number') {
      return null;
    }
    if (Date.now() > parsed.staleUntil) {
      storage.removeItem(STORAGE_PREFIX + key);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

const INDEX_KEY = STORAGE_PREFIX + '__index';

function readIndex(storage: Storage): string[] {
  try {
    const raw = storage.getItem(INDEX_KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

function writeIndex(storage: Storage, idx: string[]): void {
  try {
    storage.setItem(INDEX_KEY, JSON.stringify(idx));
  } catch {
    /* ignore */
  }
}

function bumpIndex(storage: Storage, key: string): void {
  const idx = readIndex(storage).filter((k) => k !== key);
  idx.push(key);
  writeIndex(storage, idx);
}

function writeStorage<T>(key: string, entry: StoredEntry<T>, storage: Storage): void {
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      storage.setItem(STORAGE_PREFIX + key, JSON.stringify(entry));
      bumpIndex(storage, key);
      return;
    } catch (err) {
      const name = (err as { name?: string })?.name;
      if (name !== 'QuotaExceededError' && name !== 'NS_ERROR_DOM_QUOTA_REACHED') throw err;
      const idx = readIndex(storage);
      const oldest = idx.shift();
      if (oldest === undefined) return;
      storage.removeItem(STORAGE_PREFIX + oldest);
      writeIndex(storage, idx);
    }
  }
}

export function createCachedStore<T>(opts: CachedStoreOptions<T>): CachedStore<T> {
  const storage: Storage | null =
    typeof window !== 'undefined' && opts.storage !== 'memory' ? sessionStorage : null;
  const ttl = opts.ttl ?? DEFAULT_TTL;
  const swr = opts.swr ?? DEFAULT_SWR;

  let seed: T | null = opts.initial ?? null;
  let seedStale = false;
  if (seed === null && storage) {
    const stored = readStorage<T>(opts.key, storage);
    if (stored) {
      seed = stored.value;
      seedStale = Date.now() > stored.expiresAt;
    }
  }

  let data = $state<T | null>(seed);
  let loading = $state<boolean>(seed === null);
  let error = $state<Error | null>(null);
  let stale = $state<boolean>(seedStale);

  let inFlight: Promise<void> | null = null;

  async function refresh(): Promise<void> {
    if (inFlight) return inFlight;
    inFlight = (async () => {
      loading = true;
      error = null;
      try {
        const value = await opts.fetcher();
        data = value;
        stale = false;
        if (storage) {
          const now = Date.now();
          writeStorage(
            opts.key,
            { value, expiresAt: now + ttl, staleUntil: now + ttl + swr },
            storage,
          );
        }
      } catch (e) {
        error = e instanceof Error ? e : new Error(String(e));
      } finally {
        loading = false;
        inFlight = null;
      }
    })();
    return inFlight;
  }

  function mutate(updater: (current: T | null) => T): void {
    data = updater(data);
  }

  function invalidate(): void {
    // Hard bust — explicit user-driven cache clear. Blanks the UI on purpose.
    data = null;
    stale = false;
    if (storage) storage.removeItem(STORAGE_PREFIX + opts.key);
  }

  // Soft bust — keeps the (now stale) data visible and lazily refetches on the
  // next read of `data`. Used for tag/key-driven invalidation so a broad
  // invalidate doesn't blank the UI or stampede an eager refetch across every
  // tagged store at once (defeating SWR). The first read after this triggers a
  // single background refresh (guarded by `inFlight`), then `stale` clears.
  function markStale(): void {
    stale = true;
    if (storage) storage.removeItem(STORAGE_PREFIX + opts.key);
  }

  const handle = registerStore({
    key: opts.key,
    tags: (opts.tags ?? []) as readonly string[],
    invalidate: () => {
      // SWR: mark stale + lazy refetch on next read (no blank, no stampede).
      markStale();
      // If nothing is currently displaying this store, nothing will read `data`
      // to trigger the lazy refresh — but that's fine: a stale store that no one
      // reads costs nothing, and the next reader refetches.
    },
  });

  return {
    get data() {
      // Lazy SWR refetch: a read of a stale store kicks one background refresh.
      if (stale && !inFlight) void refresh();
      return data;
    },
    get loading() {
      return loading;
    },
    get error() {
      return error;
    },
    get stale() {
      return stale;
    },
    get key() {
      return opts.key;
    },
    get tags() {
      return (opts.tags ?? []) as readonly string[];
    },
    refresh,
    invalidate,
    mutate,
    destroy() {
      unregisterStore(handle);
    },
  };
}
