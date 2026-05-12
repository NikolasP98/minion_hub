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

export function createCachedStore<T>(opts: CachedStoreOptions<T>): CachedStore<T> {
  let data = $state<T | null>(opts.initial ?? null);
  let loading = $state<boolean>(opts.initial === undefined);
  let error = $state<Error | null>(null);
  let stale = $state<boolean>(false);

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
