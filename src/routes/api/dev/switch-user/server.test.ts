import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getUserById: vi.fn(),
  generateLink: vi.fn(),
  getSession: vi.fn(),
  verifyOtp: vi.fn(),
  invalidateCachedIdentity: vi.fn(),
  checkRateLimit: vi.fn(),
}));

vi.mock('$server/auth/authorize', () => ({
  requireAuth: (locals: { user?: unknown }) => {
    if (!locals.user) throw { status: 401 };
    return locals.user;
  },
}));

vi.mock('$server/supabase', () => ({
  supabaseAdmin: () => ({
    auth: { admin: { getUserById: mocks.getUserById, generateLink: mocks.generateLink } },
  }),
  supabaseServer: () => ({
    auth: { getSession: mocks.getSession, verifyOtp: mocks.verifyOtp },
  }),
}));

vi.mock('$server/auth/identity-cache', () => ({
  invalidateCachedIdentity: mocks.invalidateCachedIdentity,
}));

vi.mock('$server/auth/rate-limit', () => ({ checkRateLimit: mocks.checkRateLimit }));

import { POST } from './+server';

function makeEvent(opts: {
  locals: unknown;
  body?: unknown;
  origin?: string | null;
  secFetchSite?: string | null;
  priorActiveOrg?: string;
}) {
  const url = new URL('https://hub.test/api/dev/switch-user');
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (opts.origin !== null) headers.origin = opts.origin ?? url.origin;
  if (opts.secFetchSite) headers['sec-fetch-site'] = opts.secFetchSite;
  const request = new Request(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(opts.body ?? {}),
  });
  const cookieStore = new Map<string, string>();
  if (opts.priorActiveOrg) cookieStore.set('active_org', opts.priorActiveOrg);
  const deleted: string[] = [];
  return {
    locals: opts.locals,
    request,
    url,
    cookies: {
      get: (name: string) => cookieStore.get(name),
      delete: (name: string) => {
        deleted.push(name);
        cookieStore.delete(name);
      },
    },
    getClientAddress: () => '127.0.0.1',
    deleted,
  } as unknown as Parameters<typeof POST>[0] & { deleted: string[] };
}

const CALLER = { id: 'caller', supabaseId: 'caller-profile', email: 'caller@qa.test' };

describe('POST /api/dev/switch-user', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.checkRateLimit.mockReturnValue(true);
    mocks.getSession.mockResolvedValue({ data: { session: { access_token: 'old-token' } } });
    mocks.verifyOtp.mockResolvedValue({ error: null });
  });

  it('404s when not on the DEV backend', async () => {
    await expect(
      POST(makeEvent({ locals: { backend: 'prd', user: CALLER }, body: { userId: 'target' } })),
    ).rejects.toMatchObject({ status: 404 });
    expect(mocks.getUserById).not.toHaveBeenCalled();
  });

  it('401s when unauthenticated', async () => {
    await expect(
      POST(makeEvent({ locals: { backend: 'dev' }, body: { userId: 'target' } })),
    ).rejects.toMatchObject({ status: 401 });
  });

  it('403s a cross-origin request', async () => {
    await expect(
      POST(
        makeEvent({
          locals: { backend: 'dev', user: CALLER },
          body: { userId: 'target' },
          origin: 'https://evil.example',
        }),
      ),
    ).rejects.toMatchObject({ status: 403 });
    expect(mocks.getUserById).not.toHaveBeenCalled();
  });

  it('403s when Sec-Fetch-Site says cross-site, even with a matching Origin', async () => {
    await expect(
      POST(
        makeEvent({
          locals: { backend: 'dev', user: CALLER },
          body: { userId: 'target' },
          secFetchSite: 'cross-site',
        }),
      ),
    ).rejects.toMatchObject({ status: 403 });
  });

  it('404s an unknown target user', async () => {
    mocks.getUserById.mockResolvedValueOnce({ data: { user: null }, error: null });
    await expect(
      POST(
        makeEvent({
          locals: { backend: 'dev', user: CALLER },
          body: { userId: 'ghost' },
        }),
      ),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('429s when rate-limited', async () => {
    mocks.checkRateLimit.mockReturnValueOnce(false);
    const res = await POST(
      makeEvent({ locals: { backend: 'dev', user: CALLER }, body: { userId: 'target' } }),
    );
    expect(res.status).toBe(429);
    expect(mocks.getUserById).not.toHaveBeenCalled();
  });

  it('happy path: mints a session via generateLink + verifyOtp, clears active_org, invalidates the old cache entry', async () => {
    mocks.getUserById.mockResolvedValueOnce({
      data: { user: { id: 'target', email: 'target@qa.test' } },
      error: null,
    });
    mocks.generateLink.mockResolvedValueOnce({
      data: { properties: { hashed_token: 'hashed-token-abc' } },
      error: null,
    });

    const event = makeEvent({
      locals: { backend: 'dev', user: CALLER },
      body: { userId: 'target' },
      priorActiveOrg: 'org-old',
    });
    const res = await POST(event);
    const body = await res.json();

    expect(mocks.generateLink).toHaveBeenCalledWith({ type: 'magiclink', email: 'target@qa.test' });
    expect(mocks.verifyOtp).toHaveBeenCalledWith({
      token_hash: 'hashed-token-abc',
      type: 'magiclink',
    });
    expect(event.deleted).toContain('active_org');
    expect(mocks.invalidateCachedIdentity).toHaveBeenCalledWith('old-token\x00org-old');
    expect(body).toEqual({ ok: true, user: { id: 'target', email: 'target@qa.test' } });
  });
});
