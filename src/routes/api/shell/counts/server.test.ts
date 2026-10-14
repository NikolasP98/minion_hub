import { beforeEach, describe, expect, it, vi } from 'vitest';

const requireCoreCtx = vi.fn();
const getTenantCtx = vi.fn();
const hasOrgCapability = vi.fn();
const requireOrgCapability = vi.fn();
const unreadCount = vi.fn();
const countPendingRequests = vi.fn();
const countPending = vi.fn();
const countPosPendingWork = vi.fn();

vi.mock('$server/auth/core-ctx', () => ({ requireCoreCtx }));
vi.mock('$server/auth/tenant-ctx', () => ({ getTenantCtx }));
vi.mock('$server/services/rbac.service', () => ({ hasOrgCapability, requireOrgCapability }));
vi.mock('$server/services/inbox/inbox.service', () => ({ unreadCount }));
vi.mock('$server/services/join/requests.service', () => ({ countPendingRequests }));
vi.mock('$server/services/pulse.service', () => ({ countPending }));
vi.mock('$server/services/pos-accounts.service', () => ({ countPosPendingWork }));

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
  countPosPendingWork.mockResolvedValue(196);
});

describe('GET /api/shell/counts', () => {
  it('returns every badge count in one call when all checks pass', async () => {
    const res = await GET!({ locals } as never);
    expect(await res.json()).toEqual({ inbox: 4, joinRequests: 3, pulse: 2, posPending: 196 });
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
    expect(await res.json()).toEqual({
      inbox: 4,
      joinRequests: 3,
      pulse: null,
      posPending: null,
    });
  });

  it('a backend failure on one field never fails the other two', async () => {
    requireCoreCtx.mockRejectedValueOnce(Object.assign(new Error('no org'), { status: 401 }));

    const res = await GET!({ locals } as never);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      inbox: null,
      joinRequests: 3,
      pulse: 2,
      posPending: 196,
    });
  });

  it('fails soft to 0 for join requests when the viewer lacks users:manage', async () => {
    hasOrgCapability.mockResolvedValue(false);

    const res = await GET!({ locals } as never);

    expect(await res.json()).toEqual({ inbox: 4, joinRequests: 0, pulse: 2, posPending: 196 });
    expect(countPendingRequests).not.toHaveBeenCalled();
  });

  /** The POS Accounts badge rides this poll because the sidebar renders on every
   *  page while `/pos/+layout.server.ts` only runs under /pos. */
  it('returns the POS pending count null — not 0 — when the viewer lacks pos:view', async () => {
    requireOrgCapability.mockImplementation(async (_l: unknown, mod: string) => {
      if (mod === 'pos') throw Object.assign(new Error('pos: view required'), { status: 403 });
      return null;
    });

    const res = await GET!({ locals } as never);

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ pulse: 2, posPending: null });
    expect(countPosPendingWork).not.toHaveBeenCalled();
  });
});
