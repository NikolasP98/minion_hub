import { beforeEach, describe, expect, it, vi } from 'vitest';

const hasOrgCapability = vi.fn();
const getTenantCtx = vi.fn();
const countPendingRequests = vi.fn();

vi.mock('$server/services/rbac.service', () => ({ hasOrgCapability }));
vi.mock('$server/auth/tenant-ctx', () => ({ getTenantCtx }));
vi.mock('$server/services/join/requests.service', () => ({ countPendingRequests }));

const { GET } = await import('./+server');

beforeEach(() => {
  vi.clearAllMocks();
  getTenantCtx.mockResolvedValue({ tenantId: 'org-1' });
  countPendingRequests.mockResolvedValue(3);
});

describe('GET /api/join-requests/count', () => {
  it('org owner (users:manage) gets the real count', async () => {
    hasOrgCapability.mockResolvedValue(true);
    const locals = { user: { id: 'u1', role: 'user' }, tenantCtx: { tenantId: 'org-1' } };

    const res = await GET!({ locals } as never);

    expect(await res.json()).toEqual({ count: 3 });
    expect(countPendingRequests).toHaveBeenCalledWith('org-1');
  });

  it('fails soft to 0 for a viewer (no users:manage)', async () => {
    hasOrgCapability.mockResolvedValue(false);
    const locals = { user: { id: 'u2', role: 'user' }, tenantCtx: { tenantId: 'org-1' } };

    const res = await GET!({ locals } as never);

    expect(await res.json()).toEqual({ count: 0 });
    expect(countPendingRequests).not.toHaveBeenCalled();
  });
});
