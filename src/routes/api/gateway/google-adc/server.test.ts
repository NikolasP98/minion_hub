import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGetTenantCtx = vi.fn<(locals: unknown) => Promise<unknown>>();
vi.mock('$server/auth/tenant-ctx', () => ({
  getTenantCtx: (locals: unknown) => mockGetTenantCtx(locals),
}));

const mockGetGoogleCredential = vi.fn<(ctx: unknown, userId: string) => Promise<unknown>>();
vi.mock('$server/services/identity.service', () => ({
  getGoogleCredential: (ctx: unknown, userId: string) => mockGetGoogleCredential(ctx, userId),
}));

const mockIsGatewayOrgMember = vi.fn<(orgId: string, profileId: string) => Promise<boolean>>();
vi.mock('$server/auth/authorize', () => ({
  isGatewayOrgMember: (orgId: string, profileId: string) =>
    mockIsGatewayOrgMember(orgId, profileId),
}));

import { GET } from './+server';

function makeEvent(userId: string | null, locals: Record<string, unknown> = { serverId: 'srv1' }) {
  const u = new URL('http://localhost/api/gateway/google-adc');
  if (userId !== null) u.searchParams.set('userId', userId);
  return { locals, url: u } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockIsGatewayOrgMember.mockResolvedValue(true);
});

describe('GET /api/gateway/google-adc', () => {
  it('401 when no tenant context (bad/no token)', async () => {
    mockGetTenantCtx.mockResolvedValue(null);
    await expect(GET(makeEvent('u1'))).rejects.toMatchObject({ status: 401 });
  });

  it('400 when userId missing', async () => {
    mockGetTenantCtx.mockResolvedValue({ db: {}, tenantId: 't1' });
    await expect(GET(makeEvent(null))).rejects.toMatchObject({ status: 400 });
  });

  it('returns the decrypted ADC for a linked user', async () => {
    mockGetTenantCtx.mockResolvedValue({ db: {}, tenantId: 't1' });
    mockGetGoogleCredential.mockResolvedValue({
      email: 'nik@example.com',
      adc: { client_id: 'c', client_secret: 's', refresh_token: 'r', type: 'authorized_user' },
    });
    const res = await GET(makeEvent('u1'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      email: 'nik@example.com',
      adc: { client_id: 'c', client_secret: 's', refresh_token: 'r', type: 'authorized_user' },
    });
    expect(mockGetGoogleCredential).toHaveBeenCalledWith({ db: {}, tenantId: 't1' }, 'u1');
  });

  it('404 when the user has no google identity', async () => {
    mockGetTenantCtx.mockResolvedValue({ db: {}, tenantId: 't1' });
    mockGetGoogleCredential.mockResolvedValue(null);
    const res = await GET(makeEvent('stranger'));
    expect(res.status).toBe(404);
  });

  it('403 when a non-admin session requests another user (no IDOR)', async () => {
    mockGetTenantCtx.mockResolvedValue({ db: {}, tenantId: 't1' });
    await expect(
      GET(makeEvent('victim', { user: { id: 'attacker', role: 'user' } })),
    ).rejects.toMatchObject({ status: 403 });
    expect(mockGetGoogleCredential).not.toHaveBeenCalled();
  });

  it('allows a user to fetch their OWN credential', async () => {
    mockGetTenantCtx.mockResolvedValue({ db: {}, tenantId: 't1' });
    mockGetGoogleCredential.mockResolvedValue({
      email: 'me@example.com',
      adc: { client_id: 'c', client_secret: 's', refresh_token: 'r', type: 'authorized_user' },
    });
    const res = await GET(makeEvent('me', { user: { id: 'me', role: 'user' } }));
    expect(res.status).toBe(200);
  });

  // audits/2026-10-15-agent-harness/E-rbac-parity.md S1
  it('404s a gateway token asking for a profile outside its own org', async () => {
    mockGetTenantCtx.mockResolvedValue({ db: {}, tenantId: 'org-a' });
    mockIsGatewayOrgMember.mockResolvedValue(false);
    const res = await GET(makeEvent('victim-in-org-b'));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'no google identity' });
    expect(mockGetGoogleCredential).not.toHaveBeenCalled();
    expect(mockIsGatewayOrgMember).toHaveBeenCalledWith('org-a', 'victim-in-org-b');
  });

  it('serves a gateway token for a member of its own org', async () => {
    mockGetTenantCtx.mockResolvedValue({ db: {}, tenantId: 'org-a' });
    mockIsGatewayOrgMember.mockResolvedValue(true);
    mockGetGoogleCredential.mockResolvedValue({
      email: 'member@example.com',
      adc: { client_id: 'c', client_secret: 's', refresh_token: 'r', type: 'authorized_user' },
    });
    const res = await GET(makeEvent('member'));
    expect(res.status).toBe(200);
    expect(mockGetGoogleCredential).toHaveBeenCalledWith({ db: {}, tenantId: 'org-a' }, 'member');
  });

  it('does not org-check an admin session (self/admin paths unchanged)', async () => {
    mockGetTenantCtx.mockResolvedValue({ db: {}, tenantId: 'org-a' });
    mockGetGoogleCredential.mockResolvedValue({
      email: 'any@example.com',
      adc: { client_id: 'c', client_secret: 's', refresh_token: 'r', type: 'authorized_user' },
    });
    const res = await GET(makeEvent('someone', { user: { id: 'admin', role: 'admin' } }));
    expect(res.status).toBe(200);
    expect(mockIsGatewayOrgMember).not.toHaveBeenCalled();
  });
});
