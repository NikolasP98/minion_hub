import { beforeEach, describe, expect, it, vi } from 'vitest';

const requireOrgCapability = vi.fn();
const revokeLink = vi.fn();

vi.mock('$server/services/rbac.service', () => ({ requireOrgCapability }));
vi.mock('$server/services/join/links.service', () => ({ revokeLink }));

const { POST } = await import('./+server');

beforeEach(() => {
  vi.clearAllMocks();
});

describe('POST /api/join-links/[id]/revoke', () => {
  it('org owner revokes a link scoped to their own org', async () => {
    requireOrgCapability.mockResolvedValue({ can: () => true });
    revokeLink.mockResolvedValue(true);
    const locals = { user: { id: 'u1', role: 'user' }, tenantCtx: { tenantId: 'org-1' } };

    const res = await POST!({ locals, params: { id: 'l1' } } as never);

    expect(res.status).toBe(200);
    expect(revokeLink).toHaveBeenCalledWith('l1', 'org-1');
  });

  it("another org's link 404s instead of revoking", async () => {
    requireOrgCapability.mockResolvedValue({ can: () => true });
    revokeLink.mockResolvedValue(false);
    const locals = { user: { id: 'u1', role: 'user' }, tenantCtx: { tenantId: 'org-1' } };

    await expect(POST!({ locals, params: { id: 'l1' } } as never)).rejects.toMatchObject({
      status: 404,
    });
  });

  it('viewer is rejected before any write', async () => {
    requireOrgCapability.mockRejectedValueOnce({ status: 403 });
    const locals = { user: { id: 'u2', role: 'user' }, tenantCtx: { tenantId: 'org-1' } };

    await expect(POST!({ locals, params: { id: 'l1' } } as never)).rejects.toMatchObject({
      status: 403,
    });
    expect(revokeLink).not.toHaveBeenCalled();
  });

  it('platform admin can revoke across orgs', async () => {
    requireOrgCapability.mockResolvedValue(null);
    revokeLink.mockResolvedValue(true);
    const locals = { user: { id: 'admin1', role: 'admin' }, tenantCtx: { tenantId: 'org-1' } };

    const res = await POST!({ locals, params: { id: 'l1' } } as never);

    expect(res.status).toBe(200);
    expect(revokeLink).toHaveBeenCalledWith('l1', undefined);
  });
});
