import { beforeEach, describe, expect, it, vi } from 'vitest';

const requireOrgCapability = vi.fn();
const denyRequest = vi.fn();

vi.mock('$server/services/rbac.service', () => ({ requireOrgCapability }));
vi.mock('$server/services/join/requests.service', () => ({ denyRequest }));

const { POST } = await import('./+server');

beforeEach(() => {
  vi.clearAllMocks();
  denyRequest.mockResolvedValue(undefined);
});

describe('POST /api/join-requests/[id]/deny', () => {
  it('org owner denies within their own tenant', async () => {
    requireOrgCapability.mockResolvedValue({ can: () => true });
    const locals = { user: { id: 'u1', role: 'user' }, tenantCtx: { tenantId: 'org-1' } };

    const res = await POST!({ locals, params: { id: 'r1' } } as never);

    expect(res.status).toBe(200);
    expect(denyRequest).toHaveBeenCalledWith('r1', { reviewerId: 'u1', organizationId: 'org-1' });
  });

  it('viewer is rejected before any write', async () => {
    requireOrgCapability.mockRejectedValueOnce({ status: 403 });
    const locals = { user: { id: 'u2', role: 'user' }, tenantCtx: { tenantId: 'org-1' } };

    await expect(POST!({ locals, params: { id: 'r1' } } as never)).rejects.toMatchObject({
      status: 403,
    });
    expect(denyRequest).not.toHaveBeenCalled();
  });
});
