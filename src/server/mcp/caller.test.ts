import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  limit: vi.fn(async (_k: string, _n: number) => true),
  verifyKey: vi.fn(),
  touchKey: vi.fn(),
  findAccess: vi.fn(),
  endConnection: vi.fn(async () => true),
  touchConnection: vi.fn(),
  profile: vi.fn(),
  tenant: vi.fn(),
  blocked: vi.fn(() => false),
}));
vi.mock('$server/auth/shared-rate-limit', () => ({
  checkSharedRateLimit: (k: string, n: number) => m.limit(k, n),
}));
vi.mock('$server/services/org-api-keys.service', () => ({
  verifyKey: m.verifyKey,
  touchKey: m.touchKey,
}));
vi.mock('$server/db/pg-client', () => ({ getCoreDb: () => ({ core: true }) }));
vi.mock('$server/db/client', () => ({ getDb: () => ({ app: true }) }));
vi.mock('$server/mcp/oauth.service', () => ({
  findAccess: m.findAccess,
  endConnection: m.endConnection,
  touchConnection: m.touchConnection,
}));
vi.mock('$server/services/canonical-directory.service', () => ({
  loadCanonicalProfile: m.profile,
}));
vi.mock('$server/config/urls', () => ({ hubBaseUrl: () => 'https://hub.test/' }));
vi.mock('$server/services/modules.service', () => ({
  listModuleStates: async () => ({ pos: true }),
}));
vi.mock('$server/services/entitlements.service', () => ({
  resolveEntitlements: async () => ({ features: ['f'] }),
}));
vi.mock('$lib/modules/route-guard', () => ({ isAppRouteBlocked: m.blocked }));
vi.mock('$server/auth/supabase-bridge.runtime', () => ({ resolveSupabaseTenant: m.tenant }));

import { resolveMcpCaller } from './caller';

const TOKEN = 'mcp_at_' + 'A'.repeat(43);
const ev = (authorization: string | null, extra: object = {}) =>
  ({
    request: new Request('https://other-host.test/api/mcp', {
      method: 'POST',
      headers: authorization ? { authorization } : {},
    }),
    getClientAddress: () => '9.9.9.9',
    ...extra,
  }) as never;
const access = { connectionId: 'c1', userId: 'u1', orgId: 'org-1', lastUsedAt: null };

beforeEach(() => {
  vi.clearAllMocks();
  m.limit.mockResolvedValue(true);
  m.findAccess.mockResolvedValue(access);
  m.profile.mockResolvedValue({ id: 'u1', email: 'a@b.test', display_name: 'Ada', role: 'user' });
  m.tenant.mockResolvedValue({ orgId: 'org-1', kind: 'business' });
  m.blocked.mockReturnValue(false);
});

describe('resolveMcpCaller', () => {
  it('a key request never touches the per-address limiter (P6)', async () => {
    m.verifyKey.mockResolvedValue({
      id: 'k1',
      orgId: 'org-9',
      lastUsedAt: null,
      scopes: ['sandbox'],
    });
    await resolveMcpCaller(ev('Bearer mk_x'));
    expect(m.limit.mock.calls.map((c) => c[0])).toEqual(['mcp-key:k1']);
  });

  it('a key never reaches the connection path', async () => {
    m.verifyKey.mockResolvedValue({
      id: 'k1',
      orgId: 'org-9',
      lastUsedAt: null,
      scopes: ['sandbox'],
    });
    const c = await resolveMcpCaller(ev('Bearer mk_x'));
    expect(c).toEqual({ kind: 'key', ctx: { db: { core: true }, tenantId: 'org-9' }, keyId: 'k1' });
    expect(m.findAccess).not.toHaveBeenCalled();
    expect(m.profile).not.toHaveBeenCalled();
  });

  it('a live connection yields the person, the connection org and exactly the permission locals', async () => {
    const c = await resolveMcpCaller(
      ev(`Bearer ${TOKEN}`, { locals: { user: { id: 'cookie-admin', role: 'admin' } } }),
    );
    expect(c).toMatchObject({
      kind: 'user',
      sandboxBlocked: false,
      connectionId: 'c1',
      ctx: { db: { core: true }, tenantId: 'org-1', profileId: 'u1' },
    });
    const { locals } = c as unknown as { locals: Record<string, unknown> };
    expect(Object.keys(locals).sort()).toEqual(['tenantCtx', 'user']);
    expect(locals.tenantCtx).toEqual({ db: { app: true }, tenantId: 'org-1' });
    expect(locals.user).toMatchObject({ supabaseId: 'u1', email: 'a@b.test', role: 'user' });
    expect(m.tenant).toHaveBeenCalledWith('u1', 'org-1'); // always the connection's org
    expect(m.touchConnection).toHaveBeenCalledWith('c1');
    expect(m.limit).toHaveBeenCalledWith('mcp-conn:c1', 120);
  });

  it('refuses unknown, expired or ended credentials with 401 and the pointer', async () => {
    m.findAccess.mockResolvedValue(null);
    const res = (await resolveMcpCaller(ev(`Bearer ${TOKEN}`))) as Response;
    expect(res.status).toBe(401);
    // The pointer uses the configured public URL (trailing slash stripped), never the request host.
    expect(res.headers.get('www-authenticate')).toBe(
      'Bearer resource_metadata="https://hub.test/.well-known/oauth-protected-resource/api/mcp", error="invalid_token"',
    );
    expect(m.profile).not.toHaveBeenCalled();
  });

  it('a person who no longer exists: 401 and the connection ends', async () => {
    m.profile.mockResolvedValue(null);
    const res = (await resolveMcpCaller(ev(`Bearer ${TOKEN}`))) as Response;
    expect(res.status).toBe(401);
    expect(m.endConnection).toHaveBeenCalledWith('c1', null);
  });

  it('a person no longer in the organization: 401 invalid_token with a description, and the connection ends (P8)', async () => {
    m.tenant.mockResolvedValue(null);
    const res = (await resolveMcpCaller(ev(`Bearer ${TOKEN}`))) as Response;
    expect(res.status).toBe(401);
    expect(res.headers.get('www-authenticate')).toMatch(
      /^Bearer resource_metadata="[^"]+", error="invalid_token", error_description="[^"]+"$/,
    );
    expect(m.endConnection).toHaveBeenCalledWith('c1', null);
  });

  it('a database failure is never read as a refusal and ends nothing: it throws (P7)', async () => {
    m.tenant.mockRejectedValue(new Error('db down'));
    await expect(resolveMcpCaller(ev(`Bearer ${TOKEN}`))).rejects.toThrow('db down');
    m.profile.mockRejectedValue(new Error('db down'));
    await expect(resolveMcpCaller(ev(`Bearer ${TOKEN}`))).rejects.toThrow('db down');
    expect(m.endConnection).not.toHaveBeenCalled();
  });

  it('applies the hub availability rule for /sandbox with the connection org kind (P10)', async () => {
    m.blocked.mockReturnValue(true);
    const c = await resolveMcpCaller(ev(`Bearer ${TOKEN}`));
    expect(c).toMatchObject({ kind: 'user', sandboxBlocked: true });
    expect(m.blocked).toHaveBeenCalledWith('/sandbox', {
      kind: 'business',
      moduleStates: { pos: true },
      features: ['f'],
    });
  });

  it('429s per address before any lookup, and per connection', async () => {
    m.limit.mockImplementation(async (k: string) => !k.startsWith('mcp-ip:'));
    expect(((await resolveMcpCaller(ev(`Bearer ${TOKEN}`))) as Response).status).toBe(429);
    expect(m.findAccess).not.toHaveBeenCalled();
    m.limit.mockImplementation(async (k: string) => !k.startsWith('mcp-conn:'));
    const res = (await resolveMcpCaller(ev(`Bearer ${TOKEN}`))) as Response;
    expect(res.status).toBe(429);
    expect(res.headers.get('retry-after')).toBe('60');
  });

  it('anything else is 401; with no credential at all the header carries only the pointer', async () => {
    for (const a of ['Basic x', 'Bearer eyJhbGciOi.jwt.token'])
      expect(((await resolveMcpCaller(ev(a))) as Response).status).toBe(401);
    const none = (await resolveMcpCaller(ev(null))) as Response;
    expect(none.headers.get('www-authenticate')).toBe(
      'Bearer resource_metadata="https://hub.test/.well-known/oauth-protected-resource/api/mcp"',
    );
  });
});
