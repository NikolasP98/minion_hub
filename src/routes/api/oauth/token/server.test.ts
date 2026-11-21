import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  limit: vi.fn(async (_k: string, _n: number) => true),
  exchange: vi.fn(),
  refresh: vi.fn(),
  prune: vi.fn(async () => undefined),
}));
vi.mock('$server/auth/shared-rate-limit', () => ({
  checkSharedRateLimit: (k: string, n: number) => m.limit(k, n),
}));
vi.mock('$server/config/urls', () => ({ hubBaseUrl: () => 'https://hub.test/' }));
vi.mock('$server/mcp/oauth.service', () => ({
  exchangeCode: m.exchange,
  refresh: m.refresh,
  pruneOauth: m.prune,
}));

import { POST } from './+server';

const PAIR = {
  access_token: 'mcp_at_a',
  token_type: 'Bearer',
  expires_in: 3600,
  refresh_token: 'mcp_rt_a',
};
const post = (params: Record<string, string>, type = 'application/x-www-form-urlencoded') =>
  POST({
    request: new Request('https://hub.test/api/oauth/token', {
      method: 'POST',
      headers: { 'content-type': type },
      body:
        type === 'application/json'
          ? JSON.stringify(params)
          : new URLSearchParams(params).toString(),
    }),
    getClientAddress: () => '5.5.5.5',
  } as never) as Promise<Response>;
const code = {
  grant_type: 'authorization_code',
  code: 'mcp_ac_x',
  code_verifier: 'v'.repeat(43),
  client_id: 'mcpc_a',
  redirect_uri: 'http://localhost:1234/cb',
};

beforeEach(() => {
  vi.clearAllMocks();
  m.limit.mockResolvedValue(true);
  m.exchange.mockResolvedValue(PAIR);
  m.refresh.mockResolvedValue(PAIR);
});

describe('POST /api/oauth/token', () => {
  it('exchanges a code (form-encoded) and answers no-store JSON', async () => {
    const res = await post(code);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toEqual(PAIR);
    expect(m.exchange).toHaveBeenCalledWith({
      code: 'mcp_ac_x',
      clientId: 'mcpc_a',
      redirectUri: 'http://localhost:1234/cb',
      verifier: 'v'.repeat(43),
    });
  });

  it('also accepts JSON', async () => {
    expect((await post(code, 'application/json')).status).toBe(200);
  });

  it('renews with a renewal credential', async () => {
    const res = await post({
      grant_type: 'refresh_token',
      refresh_token: 'mcp_rt_x',
      client_id: 'mcpc_a',
    });
    expect(res.status).toBe(200);
    expect(m.refresh).toHaveBeenCalledWith({ token: 'mcp_rt_x', clientId: 'mcpc_a' });
  });

  it('answers invalid_grant when the service refuses (used, expired, wrong proof, ended)', async () => {
    m.exchange.mockResolvedValue(null);
    m.refresh.mockResolvedValue(null);
    for (const body of [
      code,
      { grant_type: 'refresh_token', refresh_token: 'r', client_id: 'c' },
    ]) {
      const res = await post(body);
      expect(res.status).toBe(400);
      expect(res.headers.get('cache-control')).toBe('no-store');
      expect(await res.json()).toEqual({ error: 'invalid_grant' });
    }
  });

  it('answers invalid_request for missing fields and unsupported_grant_type for others', async () => {
    const { code_verifier: _v, ...noVerifier } = code;
    expect(await (await post(noVerifier)).json()).toEqual({ error: 'invalid_request' });
    expect(await (await post({ grant_type: 'refresh_token', client_id: 'c' })).json()).toEqual({
      error: 'invalid_request',
    });
    expect(await (await post({ grant_type: 'password' })).json()).toEqual({
      error: 'unsupported_grant_type',
    });
    expect(m.exchange).not.toHaveBeenCalled();
  });

  it('accepts a matching resource and refuses another with invalid_target', async () => {
    expect((await post({ ...code, resource: 'https://hub.test/api/mcp' })).status).toBe(200);
    expect(await (await post({ ...code, resource: 'https://other.test/api/mcp' })).json()).toEqual({
      error: 'invalid_target',
    });
  });

  it('compares the resource after URL normalisation (P14)', async () => {
    expect((await post({ ...code, resource: 'HTTPS://hub.test:443/api/mcp' })).status).toBe(200);
  });

  it('prunes on about 1% of calls and never lets that affect the answer (P9)', async () => {
    const random = vi.spyOn(Math, 'random');
    random.mockReturnValue(0.5);
    await post(code);
    expect(m.prune).not.toHaveBeenCalled();
    random.mockReturnValue(0.001);
    m.prune.mockRejectedValueOnce(new Error('boom'));
    expect((await post(code)).status).toBe(200);
    expect(m.prune).toHaveBeenCalledTimes(1);
    random.mockRestore();
  });

  it('429s per address before reading anything', async () => {
    m.limit.mockResolvedValue(false);
    expect((await post(code)).status).toBe(429);
    expect(m.exchange).not.toHaveBeenCalled();
  });
});
