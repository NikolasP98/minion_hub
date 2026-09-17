import { beforeEach, describe, expect, it, vi } from 'vitest';

const hasOrgCapability = vi.fn();
const getTenantCtx = vi.fn();
const listPendingRequests = vi.fn();

vi.mock('$server/services/rbac.service', () => ({ hasOrgCapability }));
vi.mock('$server/auth/tenant-ctx', () => ({ getTenantCtx }));
vi.mock('$server/services/join/requests.service', () => ({ listPendingRequests }));

const { GET } = await import('./+server');

beforeEach(() => {
  vi.clearAllMocks();
  getTenantCtx.mockResolvedValue({ tenantId: 'org-1' });
  listPendingRequests.mockResolvedValue([]);
});

describe('GET /api/join-requests/pending', () => {
  it('org owner (users:manage) gets the real list', async () => {
    hasOrgCapability.mockResolvedValue(true);
    const locals = { user: { id: 'u1', role: 'user' }, tenantCtx: { tenantId: 'org-1' } };

    await GET!({ locals } as never);

    expect(listPendingRequests).toHaveBeenCalledWith('org-1');
  });

  it('fails soft to an empty list for a viewer (no users:manage) instead of 403ing the badge', async () => {
    hasOrgCapability.mockResolvedValue(false);
    const locals = { user: { id: 'u2', role: 'user' }, tenantCtx: { tenantId: 'org-1' } };

    const res = await GET!({ locals } as never);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ requests: [] });
    expect(listPendingRequests).not.toHaveBeenCalled();
  });
});
