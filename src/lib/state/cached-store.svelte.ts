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

function writeStorage<T>(key: string, entry: StoredEntry<T>, storage: Storage): void {
  try {
    storage.setItem(STORAGE_PREFIX + key, JSON.stringify(entry));
  } catch {
    // Quota exceeded — Task 5 adds eviction. For now: swallow.
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
          writeStorage(opts.key, { value, expiresAt: now + ttl, staleUntil: now + ttl + swr }, storage);
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

  function invalidate(): void {
    data = null;
    stale = false;
    if (storage) storage.removeItem(STORAGE_PREFIX + opts.key);
  }

  return {
    get data() {
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
  };
}
