import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  limit: vi.fn(async (_k: string, _n: number, _w?: number) => true),
  register: vi.fn(async () => ({ id: 'mcpc_abc' })),
}));
vi.mock('$server/auth/shared-rate-limit', () => ({
  checkSharedRateLimit: (k: string, n: number, w?: number) => m.limit(k, n, w),
}));
vi.mock('$server/mcp/oauth.service', () => ({ registerClient: m.register }));

import { POST } from './+server';

const post = (body: unknown) =>
  POST({
    request: new Request('https://hub.test/api/oauth/register', {
      method: 'POST',
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
    getClientAddress: () => '5.5.5.5',
  } as never) as Promise<Response>;

beforeEach(() => {
  vi.clearAllMocks();
  m.limit.mockResolvedValue(true);
});

describe('POST /api/oauth/register', () => {
  it('registers a public app with loopback return addresses', async () => {
    const res = await post({
      client_name: ' Claude Code ',
      redirect_uris: ['http://localhost:3118/callback', 'http://127.0.0.1/cb'],
    });
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({
      client_id: 'mcpc_abc',
      client_name: 'Claude Code',
      token_endpoint_auth_method: 'none',
    });
    expect(m.register).toHaveBeenCalledWith(
      'Claude Code',
      ['http://localhost:3118/callback', 'http://127.0.0.1/cb'],
      '5.5.5.5',
    );
    expect(m.limit).toHaveBeenCalledWith('mcp-register:5.5.5.5', 10, 3_600_000);
  });

  it.each([
    [{ client_name: 'X', redirect_uris: ['https://evil.test/cb'] }, 'invalid_redirect_uri'],
    [
      { client_name: 'X', redirect_uris: ['http://localhost/cb', 'https://evil.test'] },
      'invalid_redirect_uri',
    ],
    [{ client_name: 'X', redirect_uris: [] }, 'invalid_redirect_uri'],
    [{ client_name: 'X' }, 'invalid_redirect_uri'],
    [{ client_name: '', redirect_uris: ['http://localhost/cb'] }, 'invalid_client_metadata'],
    [
      { client_name: 'x'.repeat(81), redirect_uris: ['http://localhost/cb'] },
      'invalid_client_metadata',
    ],
    ['{nope', 'invalid_client_metadata'],
  ])('refuses %j with %s and stores nothing', async (body, error) => {
    const res = await post(body);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error });
    expect(m.register).not.toHaveBeenCalled();
  });

  it('ignores unknown fields, strips control characters from the name and always answers auth method none (P14)', async () => {
    const res = await post({
      client_name: 'Ev\u202eil\u0007',
      redirect_uris: ['http://localhost/cb'],
      token_endpoint_auth_method: 'client_secret_basic',
      logo_uri: 'https://x.test/l.png',
    });
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({
      client_name: 'Evil',
      token_endpoint_auth_method: 'none',
    });
  });

  it('refuses a return address over 200 characters (P9)', async () => {
    const res = await post({
      client_name: 'X',
      redirect_uris: [`http://localhost/${'a'.repeat(200)}`],
    });
    expect(res.status).toBe(400);
  });

  it('429s over the hourly per-address limit', async () => {
    m.limit.mockResolvedValue(false);
    expect((await post({ client_name: 'X', redirect_uris: ['http://localhost/cb'] })).status).toBe(
      429,
    );
    expect(m.register).not.toHaveBeenCalled();
  });
});
