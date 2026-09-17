import { beforeEach, describe, expect, it, vi } from 'vitest';

const requireOrgCapability = vi.fn();
const approveRequest = vi.fn();
const denyRequest = vi.fn();
const getTenantCtx = vi.fn();

vi.mock('$server/services/rbac.service', () => ({ requireOrgCapability }));
vi.mock('$server/services/join/requests.service', () => ({ approveRequest, denyRequest }));
vi.mock('$server/auth/tenant-ctx', () => ({ getTenantCtx }));

const { POST } = await import('./+server');

const req = (body: Record<string, unknown>) =>
  new Request('http://localhost/api/join-requests/r1', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

beforeEach(() => {
  vi.clearAllMocks();
  getTenantCtx.mockResolvedValue({ tenantId: 'org-1' });
});

describe('POST /api/join-requests/[id]', () => {
  it('org owner approves within their own tenant', async () => {
    requireOrgCapability.mockResolvedValue({ can: () => true });
    const locals = { user: { id: 'u1', role: 'user' }, tenantCtx: { tenantId: 'org-1' } };

    const res = await POST!({
      locals,
      params: { id: 'r1' },
      request: req({ status: 'approved' }),
    } as never);

    expect(res.status).toBe(200);
    expect(approveRequest).toHaveBeenCalledWith('r1', {
      reviewerId: 'u1',
      role: 'user',
      organizationId: 'org-1',
    });
  });

  it('viewer is rejected before any write', async () => {
    requireOrgCapability.mockRejectedValueOnce({ status: 403 });
    const locals = { user: { id: 'u2', role: 'user' }, tenantCtx: { tenantId: 'org-1' } };

    await expect(
      POST!({ locals, params: { id: 'r1' }, request: req({ status: 'denied' }) } as never),
    ).rejects.toMatchObject({ status: 403 });
    expect(approveRequest).not.toHaveBeenCalled();
    expect(denyRequest).not.toHaveBeenCalled();
  });
});
