import { beforeEach, describe, expect, it, vi } from 'vitest';

const requireCoreCtx = vi.fn();
const getTenantCtx = vi.fn();
const hasOrgCapability = vi.fn();
const requireOrgCapability = vi.fn();
const unreadCount = vi.fn();
const countPendingRequests = vi.fn();
const countPending = vi.fn();

vi.mock('$server/auth/core-ctx', () => ({ requireCoreCtx }));
vi.mock('$server/auth/tenant-ctx', () => ({ getTenantCtx }));
vi.mock('$server/services/rbac.service', () => ({ hasOrgCapability, requireOrgCapability }));
vi.mock('$server/services/inbox/inbox.service', () => ({ unreadCount }));
vi.mock('$server/services/join/requests.service', () => ({ countPendingRequests }));
vi.mock('$server/services/pulse.service', () => ({ countPending }));

const { GET } = await import('./+server');

const coreCtx = { db: {}, tenantId: 'org-1', profileId: 'user-1' };
const locals = { user: { id: 'u1', role: 'user' }, tenantCtx: { tenantId: 'org-1' } };

beforeEach(() => {
  vi.clearAllMocks();
  requireCoreCtx.mockResolvedValue(coreCtx);
  getTenantCtx.mockResolvedValue({ tenantId: 'org-1' });
  hasOrgCapability.mockResolvedValue(true);
  requireOrgCapability.mockResolvedValue(null);
  unreadCount.mockResolvedValue(4);
  countPendingRequests.mockResolvedValue(3);
  countPending.mockResolvedValue(2);
});

describe('GET /api/shell/counts', () => {
  it('returns all three badge counts in one call when every check passes', async () => {
    const res = await GET!({ locals } as never);
    expect(await res.json()).toEqual({ inbox: 4, joinRequests: 3, pulse: 2 });
  });

  it('rejects the whole call when unauthenticated', async () => {
    await expect(GET!({ locals: {} } as never)).rejects.toMatchObject({ status: 401 });
  });

  it('a capability a caller lacks comes back null for just that field, not a 403 for the whole call', async () => {
    requireOrgCapability.mockRejectedValue(
      Object.assign(new Error('pulse: view required'), { status: 403 }),
    );

    const res = await GET!({ locals } as never);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ inbox: 4, joinRequests: 3, pulse: null });
  });

  it('a backend failure on one field never fails the other two', async () => {
    requireCoreCtx.mockRejectedValueOnce(Object.assign(new Error('no org'), { status: 401 }));

    const res = await GET!({ locals } as never);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ inbox: null, joinRequests: 3, pulse: 2 });
  });

  it('fails soft to 0 for join requests when the viewer lacks users:manage', async () => {
    hasOrgCapability.mockResolvedValue(false);

    const res = await GET!({ locals } as never);

    expect(await res.json()).toEqual({ inbox: 4, joinRequests: 0, pulse: 2 });
    expect(countPendingRequests).not.toHaveBeenCalled();
  });
});
