import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGetTenantCtx = vi.fn<(locals: unknown) => Promise<unknown>>();
vi.mock('$server/auth/tenant-ctx', () => ({
  getTenantCtx: (locals: unknown) => mockGetTenantCtx(locals),
}));

const mockResolveFeed =
  vi.fn<(ctx: unknown, userId: string, orgId?: string) => Promise<unknown[]>>();
vi.mock('$server/services/shared-identity.service', () => ({
  resolveFeedGoogleCredentials: (ctx: unknown, userId: string, orgId?: string) =>
    mockResolveFeed(ctx, userId, orgId),
}));

const mockIsGatewayOrgMember = vi.fn<(orgId: string, profileId: string) => Promise<boolean>>();
vi.mock('$server/auth/authorize', () => ({
  isGatewayOrgMember: (orgId: string, profileId: string) =>
    mockIsGatewayOrgMember(orgId, profileId),
}));

import { GET } from './+server';

function makeEvent(userId: string | null, locals: Record<string, unknown> = { serverId: 'srv1' }) {
  const u = new URL('http://localhost/api/gateway/google-identities');
  if (userId !== null) u.searchParams.set('userId', userId);
  return { locals, url: u } as never;
}

const ADC = { client_id: 'c', client_secret: 's', refresh_token: 'r', type: 'authorized_user' };

beforeEach(() => {
  vi.clearAllMocks();
  mockIsGatewayOrgMember.mockResolvedValue(true);
});

describe('GET /api/gateway/google-identities', () => {
  it('400 when userId missing', async () => {
    await expect(GET(makeEvent(null))).rejects.toMatchObject({ status: 400 });
  });

  it('403 when a non-admin session requests another user (no IDOR)', async () => {
    await expect(
      GET(makeEvent('victim', { user: { id: 'attacker', role: 'user' } })),
    ).rejects.toMatchObject({ status: 403 });
    expect(mockResolveFeed).not.toHaveBeenCalled();
  });

  // audits/2026-10-15-agent-harness/E-rbac-parity.md S1
  it('returns no identities for a profile outside the gateway org, without touching the vault', async () => {
    mockGetTenantCtx.mockResolvedValue({ db: {}, tenantId: 'org-a' });
    mockIsGatewayOrgMember.mockResolvedValue(false);
    const res = await GET(makeEvent('victim-in-org-b'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ identities: [] });
    expect(mockResolveFeed).not.toHaveBeenCalled();
    expect(mockIsGatewayOrgMember).toHaveBeenCalledWith('org-a', 'victim-in-org-b');
  });

  it('serves a gateway token for a member of its own org', async () => {
    mockGetTenantCtx.mockResolvedValue({ db: {}, tenantId: 'org-a' });
    mockResolveFeed.mockResolvedValue([{ email: 'member@example.com', adc: ADC, shared: false }]);
    const res = await GET(makeEvent('member'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      identities: [{ email: 'member@example.com', adc: ADC, shared: false }],
    });
  });

  it('does not org-check an admin session (self/admin paths unchanged)', async () => {
    mockGetTenantCtx.mockResolvedValue({ db: {}, tenantId: 'org-a' });
    mockResolveFeed.mockResolvedValue([]);
    const res = await GET(makeEvent('someone', { user: { id: 'admin', role: 'admin' } }));
    expect(res.status).toBe(200);
    expect(mockIsGatewayOrgMember).not.toHaveBeenCalled();
  });
});
