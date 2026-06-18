const DEFAULT_BASE = 'https://api.susii.com';

/** Per-request timeout — a hung SUSII response aborts instead of parking the worker forever. */
const REQUEST_TIMEOUT_MS = 30_000;
/** Backoff schedule for retryable failures (timeout / 429 / 5xx). */
const RETRY_BACKOFF_MS = [1_000, 4_000, 12_000];
/** Gentle pacing between page fetches so the fast batched sync doesn't trip SUSII rate-limiting. */
const PAGE_DELAY_MS = 300;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export class SusiiClient {
  private token: string | null = null;
  private readonly base: string;
  constructor(private creds: { username: string; password: string; baseUrl?: string }) {
    this.base = creds.baseUrl ?? DEFAULT_BASE;
  }

  /** fetch + AbortController timeout. Throws on timeout (AbortError) or network error. */
  private async fetchOnce(url: string, init?: RequestInit): Promise<Response> {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
    try {
      return await fetch(url, { ...init, signal: ctrl.signal });
    } finally {
      clearTimeout(t);
    }
  }

  /**
   * fetch with timeout + retry/backoff. Retries on a network/timeout error or a
   * retryable status (429, 5xx); a 4xx other than 429 is returned to the caller
   * (non-retryable). After the backoff schedule is exhausted, the last error/response
   * surfaces so advanceJob fails the page with the cursor preserved (resume retries it).
   */
  private async fetchRetry(url: string, init?: RequestInit): Promise<Response> {
    let lastErr: unknown;
    for (let attempt = 0; attempt <= RETRY_BACKOFF_MS.length; attempt++) {
      try {
        const res = await this.fetchOnce(url, init);
        if (res.status === 429 || res.status >= 500) {
          lastErr = new Error(`susii ${res.status}`);
          if (attempt < RETRY_BACKOFF_MS.length) { await sleep(RETRY_BACKOFF_MS[attempt]); continue; }
          return res; // exhausted — let the caller treat as a failure
        }
        return res;
      } catch (e) {
        lastErr = e; // timeout (AbortError) or network failure
        if (attempt < RETRY_BACKOFF_MS.length) { await sleep(RETRY_BACKOFF_MS[attempt]); continue; }
        throw lastErr instanceof Error ? lastErr : new Error('susii request failed');
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error('susii request failed');
  }

  async login(): Promise<void> {
    const res = await this.fetchRetry(`${this.base}/auth/login/`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: this.creds.username, password: this.creds.password }),
    });
    if (!res.ok) throw new Error(`susii login failed: ${res.status}`);
    const { key } = (await res.json()) as { key: string };
    this.token = key;
  }

  private async authedGet(url: string): Promise<Response> {
    if (!this.token) await this.login();
    let res = await this.fetchRetry(url, { headers: { Authorization: `Token ${this.token}` } });
    if (res.status === 401) {
      await this.login();
      res = await this.fetchRetry(url, { headers: { Authorization: `Token ${this.token}` } });
    }
    return res;
  }

  private buildSalesUrl(opts: { businessId: number; since?: string; pageSize?: number }): string {
    const u = new URL(`${this.base}/v1/sales/sales/`);
    u.searchParams.set('business', String(opts.businessId));
    u.searchParams.set('page_size', String(opts.pageSize ?? 100));
    if (opts.since) u.searchParams.set('modified_after', opts.since);
    return u.toString();
  }

  async *salesPages(
    opts: { businessId: number; since?: string; pageSize?: number; cursor?: string | null },
  ): AsyncIterable<{ results: unknown[]; next: string | null }> {
    let next: string | null = opts.cursor ?? this.buildSalesUrl(opts);
    let first = true;
    while (next) {
      if (!first) await sleep(PAGE_DELAY_MS); // pace requests to avoid rate-limiting
      first = false;
      const res = await this.authedGet(next);
      if (!res.ok) throw new Error(`susii sales fetch failed: ${res.status}`);
      const body = (await res.json()) as { results?: unknown[]; next?: string | null };
      yield { results: body.results ?? [], next: body.next ?? null };
      next = body.next ?? null;
    }
  }

  async count(opts: { businessId: number; since?: string }): Promise<number | null> {
    const url = this.buildSalesUrl({ ...opts, pageSize: 1 });
    const res = await this.authedGet(url);
    if (!res.ok) return null;
    const body = (await res.json()) as { count?: number };
    return typeof body.count === 'number' ? body.count : null;
  }
}
