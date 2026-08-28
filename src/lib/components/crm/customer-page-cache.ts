export type PageFetcher<T> = (url: string, signal: AbortSignal) => Promise<T>;

/**
 * Small navigation cache for server-paginated customer pages. Foreground
 * requests are latest-wins (the previous fetch is aborted), while idle
 * prefetches are coalesced and promoted into the same bounded LRU.
 */
export class CustomerPageCache<T> {
  private readonly values = new Map<string, T>();
  private readonly prefetches = new Map<
    string,
    { controller: AbortController; promise: Promise<T> }
  >();
  private foreground: { url: string; controller: AbortController; promise: Promise<T> } | null =
    null;

  constructor(
    private readonly fetchPage: PageFetcher<T>,
    private readonly maxEntries = 12,
  ) {}

  async load(url: string): Promise<T> {
    const cached = this.read(url);
    if (cached !== undefined) return cached;

    const prefetched = this.prefetches.get(url);
    if (prefetched) return prefetched.promise;
    if (this.foreground?.url === url) return this.foreground.promise;

    this.foreground?.controller.abort();
    const controller = new AbortController();
    const promise = this.fetchPage(url, controller.signal).then((value) => {
      this.write(url, value);
      return value;
    });
    this.foreground = { url, controller, promise };
    try {
      return await promise;
    } finally {
      if (this.foreground?.controller === controller) this.foreground = null;
    }
  }

  prefetch(url: string): Promise<T> {
    const cached = this.read(url);
    if (cached !== undefined) return Promise.resolve(cached);
    const existing = this.prefetches.get(url);
    if (existing) return existing.promise;

    const controller = new AbortController();
    const promise = this.fetchPage(url, controller.signal)
      .then((value) => {
        this.write(url, value);
        return value;
      })
      .finally(() => {
        if (this.prefetches.get(url)?.controller === controller) this.prefetches.delete(url);
      });
    this.prefetches.set(url, { controller, promise });
    return promise;
  }

  clear(): void {
    this.foreground?.controller.abort();
    for (const { controller } of this.prefetches.values()) controller.abort();
    this.foreground = null;
    this.values.clear();
    this.prefetches.clear();
  }

  private read(url: string): T | undefined {
    const value = this.values.get(url);
    if (value === undefined) return undefined;
    this.values.delete(url);
    this.values.set(url, value);
    return value;
  }

  private write(url: string, value: T): void {
    this.values.delete(url);
    this.values.set(url, value);
    while (this.values.size > this.maxEntries) {
      const oldest = this.values.keys().next().value;
      if (oldest === undefined) break;
      this.values.delete(oldest);
    }
  }
}

export function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}
