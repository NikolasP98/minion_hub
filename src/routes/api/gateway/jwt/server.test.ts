import { describe, expect, it, vi, beforeEach } from 'vitest';
const f = vi.hoisted(() => ({ issue: vi.fn(), enforced: false, resolve: vi.fn() }));
vi.mock('$server/services/entitlements.service', () => ({
  isEnforced: () => f.enforced,
  resolveEntitlements: f.resolve,
}));
vi.mock('$server/services/gateway-jwt.service', () => ({
  issueGatewayJwt: f.issue,
  GatewayJwtAccessDenied: class GatewayJwtAccessDenied extends Error {},
}));
import { GatewayJwtAccessDenied } from '$server/services/gateway-jwt.service';
import { GET } from './+server';
const user = { id: 'user', role: 'user' as const, email: 'fixture@example.test' };
beforeEach(() => {
  vi.resetAllMocks();
  f.enforced = false;
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
      status: 500,
    },
  ])('sets no-store on $name', async ({ name, locals, status }) => {
    if (name === 'removed membership')
      f.issue.mockRejectedValue(new GatewayJwtAccessDenied('revoked'));
    else if (name === 'storage outage')
      f.issue.mockRejectedValue(new Error('PRIVATE_DATABASE_SENTINEL'));
    else f.issue.mockResolvedValue({ token: 'signed-fixture', expiresAt: 1000 });
    const response = await GET({ locals } as Parameters<typeof GET>[0]);
    expect(response.status).toBe(status);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.text()).not.toContain('PRIVATE_DATABASE_SENTINEL');
    if (status === 401 || name === 'no active organization') expect(f.issue).not.toHaveBeenCalled();
  });
});

describe('entitlement claims (spec 043)', () => {
  const locals = { user, tenantCtx: { db: {} as never, tenantId: 'org' } };
  const issued = async () => {
    f.issue.mockResolvedValue({ token: 'signed-fixture', expiresAt: 1000 });
    const response = await GET({ locals } as never);
    expect(response.status).toBe(200);
    return f.issue.mock.calls[0][2];
  };
  it('omits plan claims when not enforced, without a lookup', async () => {
    expect(await issued()).toBeUndefined();
    expect(f.resolve).not.toHaveBeenCalled();
  });
  it('adds plan and the expanded features when enforced', async () => {
    f.enforced = true;
    f.resolve.mockResolvedValue({ plan: 'base', features: [], lookupError: false });
    expect(await issued()).toEqual({ plan: 'base', features: [] });
    expect(f.resolve).toHaveBeenCalledWith('org');
  });
  it('issues without claims on a lookup error', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    f.enforced = true;
    f.resolve.mockResolvedValue({ plan: 'base', features: ['ai'], lookupError: true });
    expect(await issued()).toBeUndefined();
  });
});
