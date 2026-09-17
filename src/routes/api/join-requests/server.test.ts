import { beforeEach, describe, expect, it, vi } from 'vitest';

const requireOrgCapability = vi.fn();
const listPendingRequests = vi.fn();
const createRequest = vi.fn();
const listAllOrganizations = vi.fn();

vi.mock('$server/services/rbac.service', () => ({ requireOrgCapability }));
vi.mock('$server/services/join/requests.service', () => ({ createRequest, listPendingRequests }));
vi.mock('$server/services/organizations.service', () => ({ listAllOrganizations }));

const { GET } = await import('./+server');

beforeEach(() => {
  vi.clearAllMocks();
  listPendingRequests.mockResolvedValue([]);
});

describe('GET /api/join-requests', () => {
  it('org owner lists their own tenant pending requests', async () => {
    requireOrgCapability.mockResolvedValue({ can: () => true });
    const locals = { user: { id: 'u1', role: 'user' }, tenantCtx: { tenantId: 'org-1' } };

    await GET!({ locals } as never);

    expect(requireOrgCapability).toHaveBeenCalledWith(locals, 'users', 'manage');
    expect(listPendingRequests).toHaveBeenCalledWith('org-1');
  });

  it('viewer is rejected', async () => {
    requireOrgCapability.mockRejectedValueOnce({ status: 403 });
    const locals = { user: { id: 'u2', role: 'user' }, tenantCtx: { tenantId: 'org-1' } };

    await expect(GET!({ locals } as never)).rejects.toMatchObject({ status: 403 });
    expect(listPendingRequests).not.toHaveBeenCalled();
  });

  it('platform admin allowed', async () => {
    requireOrgCapability.mockResolvedValue(null);
    const locals = { user: { id: 'admin1', role: 'admin' }, tenantCtx: { tenantId: 'org-1' } };

    const res = await GET!({ locals } as never);

    expect(res.status).toBe(200);
  });
});
