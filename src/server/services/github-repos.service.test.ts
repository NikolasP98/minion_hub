import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * The load-bearing property: NOTHING in this service throws. A page load awaits
 * these directly, and an unguarded throw in a SvelteKit load 500s the whole
 * route subtree (shipped twice before). Every failure mode must surface as
 * `{ ok: false, reason }`.
 */
const envMock = { GITHUB_TOKEN: 'ghp_test' } as Record<string, string | undefined>;
vi.mock('$env/dynamic/private', () => ({ env: envMock }));
// Cache is a pass-through here — we are testing the fetch/error path, not TTLs.
vi.mock('@minion-stack/cache', () => ({
  cached: (_key: unknown, _opts: unknown, fn: () => unknown) => fn(),
  invalidateTags: vi.fn(async () => {}),
  keys: { hub: (name: string, parts: unknown) => `${name}:${JSON.stringify(parts)}` },
  tags: { tenantDomain: (o: string, d: string) => `${o}:${d}` },
}));

const REF = { owner: 'NikolasP98', repo: 'minion_hub' };

function respond(status: number, body: unknown = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

let svc: typeof import('./github-repos.service');

beforeEach(async () => {
  vi.resetModules();
  envMock.GITHUB_TOKEN = 'ghp_test';
  svc = await import('./github-repos.service');
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('github-repos.service failure contract', () => {
  it('reports not_configured instead of throwing when the token is absent', async () => {
    envMock.GITHUB_TOKEN = undefined;
    vi.resetModules();
    const fresh = await import('./github-repos.service');
    await expect(fresh.listBranches('org', REF)).resolves.toEqual({
      ok: false,
      reason: 'not_configured',
    });
  });

  it('rejects a repo name that could escape the URL, without any fetch', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const res = await svc.listPulls('org', { owner: '../evil', repo: 'x' });
    expect(res).toEqual({ ok: false, reason: 'invalid_repo' });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('maps 404 to not_found', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => respond(404, { message: 'Not Found' })),
    );
    await expect(svc.getRepoMeta('org', REF)).resolves.toEqual({ ok: false, reason: 'not_found' });
  });

  it('maps 403 and 429 to rate_limited', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => respond(403)),
    );
    await expect(svc.listCommits('org', REF, 'main')).resolves.toEqual({
      ok: false,
      reason: 'rate_limited',
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => respond(429)),
    );
    await expect(svc.listCommits('org', REF, 'main')).resolves.toEqual({
      ok: false,
      reason: 'rate_limited',
    });
  });

  it('turns a thrown network error into a result, not an exception', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('ECONNRESET');
      }),
    );
    await expect(svc.listBranches('org', REF)).resolves.toEqual({ ok: false, reason: 'error' });
  });

  it('returns mapped branches on success', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        respond(200, [{ name: 'main', commit: { sha: 'abc123' }, protected: true }]),
      ),
    );
    const res = await svc.listBranches('org', REF);
    expect(res).toEqual({ ok: true, data: [{ name: 'main', sha: 'abc123', protected: true }] });
  });

  it('posts the right review event and appends attribution', async () => {
    const fetchSpy = vi.fn(async () => respond(200, { id: 55 }));
    vi.stubGlobal('fetch', fetchSpy);
    const res = await svc.submitReview(REF, {
      number: 12,
      decision: 'request_changes',
      body: 'Gate 2 needs the data section.',
      attribution: 'Nikolas via Minion',
    });
    expect(res).toEqual({ ok: true, data: { id: 55 } });
    const [url, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain('/repos/NikolasP98/minion_hub/pulls/12/reviews');
    expect(init.method).toBe('POST');
    const sent = JSON.parse(init.body as string);
    expect(sent.event).toBe('REQUEST_CHANGES');
    expect(sent.body).toContain('Gate 2 needs the data section.');
    expect(sent.body).toContain('Nikolas via Minion');
  });

  it('refuses a non-positive pull number without calling GitHub', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const res = await svc.submitReview(REF, {
      number: 0,
      decision: 'approve',
      body: 'ok',
      attribution: 'x',
    });
    expect(res).toEqual({ ok: false, reason: 'error' });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
