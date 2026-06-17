const DEFAULT_BASE = 'https://api.susii.com';

export class SusiiClient {
  private token: string | null = null;
  private readonly base: string;
  constructor(private creds: { username: string; password: string; baseUrl?: string }) {
    this.base = creds.baseUrl ?? DEFAULT_BASE;
  }

  async login(): Promise<void> {
    const res = await fetch(`${this.base}/auth/login/`, {
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
    let res = await fetch(url, { headers: { Authorization: `Token ${this.token}` } });
    if (res.status === 401) {
      await this.login();
      res = await fetch(url, { headers: { Authorization: `Token ${this.token}` } });
    }
    return res;
  }

  async *salesPages(opts: { businessId: number; since?: string; pageSize?: number }): AsyncIterable<unknown[]> {
    const u = new URL(`${this.base}/v1/sales/sales/`);
    u.searchParams.set('business', String(opts.businessId));
    u.searchParams.set('page_size', String(opts.pageSize ?? 100));
    if (opts.since) u.searchParams.set('modified_after', opts.since);
    let next: string | null = u.toString();
    while (next) {
      const res = await this.authedGet(next);
      if (!res.ok) throw new Error(`susii sales fetch failed: ${res.status}`);
      const body = (await res.json()) as { results?: unknown[]; next?: string | null };
      yield body.results ?? [];
      next = body.next ?? null;
    }
  }
}
