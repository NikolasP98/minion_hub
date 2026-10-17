import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGetTenantCtx = vi.fn<(locals: unknown) => Promise<unknown>>();
vi.mock('$server/auth/tenant-ctx', () => ({
  getTenantCtx: (locals: unknown) => mockGetTenantCtx(locals),
}));

const mockList = vi.fn<(ctx: unknown) => Promise<unknown[]>>();
vi.mock('$server/services/channel-identity.service', () => ({
  listChannelIdentities: (ctx: unknown) => mockList(ctx),
}));

import { GET } from './+server';

const event = (locals: Record<string, unknown>) => ({ locals }) as never;

beforeEach(() => {
  vi.clearAllMocks();
  mockGetTenantCtx.mockResolvedValue({ db: {}, tenantId: 'org-a' });
  mockList.mockResolvedValue([
    { id: 'i1', userId: 'u1', channel: 'whatsapp', channelUserId: '+51999', displayName: null },
  ]);
});

describe('GET /api/gateway/channel-identities', () => {
  it('401 when no tenant context', async () => {
    mockGetTenantCtx.mockResolvedValue(null);
    await expect(GET(event({}))).rejects.toMatchObject({ status: 401 });
  });

  // audits/2026-10-15-agent-harness/E-rbac-parity.md S2
  it('403s a plain member session — the list is not org-scoped', async () => {
    await expect(GET(event({ user: { id: 'u2', role: 'user' } }))).rejects.toMatchObject({
      status: 403,
    });
    expect(mockList).not.toHaveBeenCalled();
  });

  it('serves a gateway server token', async () => {
    const res = await GET(event({ serverId: 'srv1' }));
    expect(res.status).toBe(200);
    expect(((await res.json()) as { identities: unknown[] }).identities).toHaveLength(1);
  });

  it('serves an admin session', async () => {
    const res = await GET(event({ user: { id: 'a1', role: 'admin' } }));
    expect(res.status).toBe(200);
  });
});
