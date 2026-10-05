import { describe, expect, it, vi, beforeEach } from 'vitest';
const f = vi.hoisted(() => ({ issue: vi.fn() }));
vi.mock('$server/services/gateway-jwt.service', () => ({
  issueGatewayJwt: f.issue,
  GatewayJwtAccessDenied: class GatewayJwtAccessDenied extends Error {},
}));
import { GatewayJwtAccessDenied } from '$server/services/gateway-jwt.service';
import { GET } from './+server';
const user = { id: 'user', role: 'user' as const, email: 'fixture@example.test' };
beforeEach(() => {
  vi.resetAllMocks();
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
