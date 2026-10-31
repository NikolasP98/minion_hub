import { describe, expect, it, vi, beforeEach } from 'vitest';
const f = vi.hoisted(() => ({
  issue: vi.fn(),
  gatewayUrl: vi.fn(),
  linked: vi.fn(),
  publicEnv: {} as Record<string, string | undefined>,
}));
vi.mock('$server/services/gateway-jwt.service', () => ({
  issueGatewayJwt: f.issue,
  gatewayAudience: (url: string) => `gw:${new URL(url).host}`,
  GatewayJwtAccessDenied: class GatewayJwtAccessDenied extends Error {},
}));
vi.mock('$server/services/gateway.pg.service', () => ({
  getGatewayUrlForOrg: f.gatewayUrl,
  userHasGatewayAccess: f.linked,
}));
vi.mock('$env/dynamic/public', () => ({ env: f.publicEnv }));
import { GatewayJwtAccessDenied } from '$server/services/gateway-jwt.service';
import { GET } from './+server';
const user = { id: 'user', role: 'user' as const, email: 'fixture@example.test' };
const noUrl = new URL('https://hub.example.test/api/gateway/jwt');
beforeEach(() => {
  vi.resetAllMocks();
  delete f.publicEnv.PUBLIC_GATEWAY_BROWSER_SHARED_TOKEN;
});

describe('gateway credential response cache boundary', () => {
  it.each([
    { name: 'anonymous', locals: {}, status: 401 },
    { name: 'no active organization', locals: { user }, status: 403 },
    {
      name: 'success',
      locals: { user, tenantCtx: { db: {} as never, tenantId: 'org' } },
      status: 200,
    },
    {
      name: 'removed membership',
      locals: { user, tenantCtx: { db: {} as never, tenantId: 'org' } },
      status: 403,
    },
    {
      name: 'storage outage',
      locals: { user, tenantCtx: { db: {} as never, tenantId: 'org' } },
      status: 503,
    },
  ])('sets no-store on $name', async ({ name, locals, status }) => {
    if (name === 'removed membership')
      f.issue.mockRejectedValue(new GatewayJwtAccessDenied('revoked'));
    else if (name === 'storage outage')
      f.issue.mockRejectedValue(new Error('PRIVATE_DATABASE_SENTINEL'));
    else f.issue.mockResolvedValue({ token: 'signed-fixture', expiresAt: 1000 });
    const response = await GET({ locals, url: noUrl } as Parameters<typeof GET>[0]);
    expect(response.status).toBe(status);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.text()).not.toContain('PRIVATE_DATABASE_SENTINEL');
    if (status === 503) expect(response.headers.get('retry-after')).toBe('2');
    if (status === 401 || name === 'no active organization') expect(f.issue).not.toHaveBeenCalled();
  });
});

describe('per-gateway issuance (spec 045 A2)', () => {
  // Turso legacy-link fallback: no rows.
  const tursoDb = {
    select: () => ({ from: () => ({ where: () => Promise.resolve([]) }) }),
  } as never;
  const call = (gatewayId: string | null, role: 'user' | 'admin' = 'user') => {
    const url = new URL(noUrl);
    if (gatewayId) url.searchParams.set('gatewayId', gatewayId);
    const locals = {
      user: { ...user, role, supabaseId: 'profile-1' },
      tenantCtx: { db: tursoDb, tenantId: 'org' },
    };
    return GET({ locals, url } as unknown as Parameters<typeof GET>[0]);
  };
  beforeEach(() => {
    f.issue.mockResolvedValue({ token: 'signed-fixture', expiresAt: 1000 });
  });

  it('without gatewayId issues the legacy credential unchanged', async () => {
    const res = await call(null);
    expect(res.status).toBe(200);
    expect(f.issue).toHaveBeenCalledWith(expect.anything(), 'user', { audience: undefined });
    expect(f.gatewayUrl).not.toHaveBeenCalled();
  });

  it('binds the JWT to a linked gateway of the active org', async () => {
    f.gatewayUrl.mockResolvedValue('wss://GW.example.test:8443/ws');
    f.linked.mockResolvedValue(true);
    const res = await call('gw-1');
    expect(res.status).toBe(200);
    expect(f.gatewayUrl).toHaveBeenCalledWith('gw-1', 'org');
    expect(f.linked).toHaveBeenCalledWith('profile-1', 'gw-1');
    expect(f.issue).toHaveBeenCalledWith(expect.anything(), 'user', {
      audience: 'gw:gw.example.test:8443',
    });
  });

  it('403 gateway_forbidden for a gateway outside the active org', async () => {
    f.gatewayUrl.mockResolvedValue(null);
    f.linked.mockResolvedValue(true);
    const res = await call('other-org-gw');
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: 'gateway_forbidden' });
    expect(f.issue).not.toHaveBeenCalled();
  });

  it('403 gateway_forbidden for an org gateway the member has no link to', async () => {
    f.gatewayUrl.mockResolvedValue('wss://gw.example.test');
    f.linked.mockResolvedValue(false);
    const res = await call('gw-1');
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: 'gateway_forbidden' });
    expect(f.issue).not.toHaveBeenCalled();
  });

  it('a platform admin needs no link but still the org check', async () => {
    f.gatewayUrl.mockResolvedValue('wss://gw.example.test');
    expect((await call('gw-1', 'admin')).status).toBe(200);
    expect(f.linked).not.toHaveBeenCalled();
    f.gatewayUrl.mockResolvedValue(null);
    expect((await call('other-org-gw', 'admin')).status).toBe(403);
  });

  it('requires gatewayId once browsers stop carrying the shared token', async () => {
    f.publicEnv.PUBLIC_GATEWAY_BROWSER_SHARED_TOKEN = 'false';
    const res = await call(null);
    expect(res.status).toBe(400);
    expect(f.issue).not.toHaveBeenCalled();
  });
});
