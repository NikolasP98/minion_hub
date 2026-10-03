import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  listDevQaLoginUsers: vi.fn(),
  getUserById: vi.fn(),
  generateLink: vi.fn(),
  verifyOtp: vi.fn(),
  checkRateLimit: vi.fn(),
}));

vi.mock('$server/services/dev-qa-login.service', async (importOriginal) => {
  const original = await importOriginal<typeof import('$server/services/dev-qa-login.service')>();
  return { ...original, listDevQaLoginUsers: mocks.listDevQaLoginUsers };
});
vi.mock('$server/supabase', () => ({
  supabaseAdmin: () => ({
    auth: { admin: { getUserById: mocks.getUserById, generateLink: mocks.generateLink } },
  }),
  supabaseServer: () => ({
    auth: { verifyOtp: mocks.verifyOtp },
  }),
}));
vi.mock('$server/auth/rate-limit', () => ({ checkRateLimit: mocks.checkRateLimit }));

import { GET, POST } from './+server';

const USER_ID = '2438ad59-073d-4c53-a018-cf7f10cbd913';

function event(options: {
  method?: 'GET' | 'POST';
  backend?: 'dev' | 'prd';
  hostname?: string;
  body?: unknown;
  origin?: string | null;
  site?: string | null;
}) {
  const hostname = options.hostname ?? '127.0.0.1';
  const url = new URL(`http://${hostname}:5201/api/dev/qa-login`);
  const headers: Record<string, string> = {};
  if (options.method === 'POST') headers['content-type'] = 'application/json';
  if (options.origin !== null) headers.origin = options.origin ?? url.origin;
  if (options.site) headers['sec-fetch-site'] = options.site;
  const request = new Request(url, {
    method: options.method ?? 'GET',
    headers,
    body: options.method === 'POST' ? JSON.stringify(options.body ?? {}) : undefined,
  });
  const deleted: string[] = [];
  return {
    locals: { backend: options.backend ?? 'dev' },
    url,
    request,
    cookies: {
      get: (name: string) => (name === 'active_org' ? 'old-org' : undefined),
      delete: (name: string) => deleted.push(name),
    },
    getClientAddress: () => '127.0.0.1',
    deleted,
  } as unknown as Parameters<typeof POST>[0] & { deleted: string[] };
}

describe('/api/dev/qa-login guards and list', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.checkRateLimit.mockReturnValue(true);
    mocks.listDevQaLoginUsers.mockResolvedValue({ users: [], truncated: false });
    mocks.verifyOtp.mockResolvedValue({ error: null });
  });

  it('denies non-DEV and non-loopback requests before privileged work', async () => {
    await expect(GET(event({ backend: 'prd' }))).rejects.toMatchObject({ status: 404 });
    expect((await GET(event({ hostname: 'hub.test' }))).status).toBe(404);
    expect(mocks.checkRateLimit).not.toHaveBeenCalled();
    expect(mocks.listDevQaLoginUsers).not.toHaveBeenCalled();
  });

  it('lists anonymously with no-store and its own bounded limiter', async () => {
    const response = await GET(event({}));
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(mocks.checkRateLimit).toHaveBeenCalledWith('dev-qa-login-list:127.0.0.1', 60);
  });

  it('rejects absent or contradictory same-origin evidence before target lookup', async () => {
    const absent = event({ method: 'POST', body: { userId: USER_ID }, origin: null });
    await expect((await POST(absent)).status).toBe(403);
    const contradictory = event({
      method: 'POST',
      body: { userId: USER_ID },
      origin: 'http://127.0.0.1:5201',
      site: 'cross-site',
    });
    await expect((await POST(contradictory)).status).toBe(403);
    expect(mocks.getUserById).not.toHaveBeenCalled();
  });

  it('rate-limits before parsing or provider lookup', async () => {
    mocks.checkRateLimit.mockReturnValue(false);
    const response = await POST(event({ method: 'POST', body: { userId: USER_ID } }));
    expect(response.status).toBe(429);
    expect(mocks.getUserById).not.toHaveBeenCalled();
  });

  it('uses one generic response for missing and ineligible targets', async () => {
    mocks.getUserById
      .mockResolvedValueOnce({ data: { user: null }, error: new Error('provider detail') })
      .mockResolvedValueOnce({
        data: { user: { id: USER_ID, email: 'ordinary@minion.test' } },
        error: null,
      });
    for (let index = 0; index < 2; index += 1) {
      const response = await POST(event({ method: 'POST', body: { userId: USER_ID } }));
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ error: 'qa_user_unavailable' });
    }
    expect(mocks.generateLink).not.toHaveBeenCalled();
  });

  it('maps a thrown provider lookup to the same generic unavailable response', async () => {
    mocks.getUserById.mockRejectedValueOnce(new Error('provider connection detail'));
    const response = await POST(event({ method: 'POST', body: { userId: USER_ID } }));
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'qa_user_unavailable' });
  });

  it('mints real SSR cookies, clears prior identity state, and returns no token or user data', async () => {
    mocks.getUserById.mockResolvedValue({
      data: { user: { id: USER_ID, email: ' Owner@QA.MINION.TEST ' } },
      error: null,
    });
    mocks.generateLink.mockResolvedValue({
      data: { properties: { hashed_token: 'secret-hash' } },
      error: null,
    });
    const requestEvent = event({ method: 'POST', body: { userId: USER_ID } });
    const response = await POST(requestEvent);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(mocks.generateLink).toHaveBeenCalledWith({
      type: 'magiclink',
      email: 'owner@qa.minion.test',
    });
    expect(mocks.verifyOtp).toHaveBeenCalledWith({
      token_hash: 'secret-hash',
      type: 'magiclink',
    });
    expect(requestEvent.deleted).toContain('active_org');
  });
});
