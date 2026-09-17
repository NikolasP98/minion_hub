import { beforeEach, describe, expect, it, vi } from 'vitest';

const requireOrgCapability = vi.fn();
const approveRequest = vi.fn();

vi.mock('$server/services/rbac.service', () => ({ requireOrgCapability }));
vi.mock('$server/services/join/requests.service', () => ({ approveRequest }));

const { POST } = await import('./+server');

const req = (body: Record<string, unknown>) =>
  new Request('http://localhost/api/join-requests/r1/approve', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

beforeEach(() => {
  vi.clearAllMocks();
  approveRequest.mockResolvedValue(undefined);
});

describe('POST /api/join-requests/[id]/approve', () => {
  it('org owner approves into their own org', async () => {
    requireOrgCapability.mockResolvedValue({ can: () => true });
    const locals = { user: { id: 'u1', role: 'user' }, tenantCtx: { tenantId: 'org-1' } };

    const res = await POST!({
      locals,
      params: { id: 'r1' },
      request: req({ organizationId: 'org-1', role: 'user' }),
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
      POST!({ locals, params: { id: 'r1' }, request: req({ organizationId: 'org-1' }) } as never),
    ).rejects.toMatchObject({ status: 403 });
    expect(approveRequest).not.toHaveBeenCalled();
  });

  it('cross-org approve is rejected for a non-platform-admin', async () => {
    requireOrgCapability.mockResolvedValue({ can: () => true });
    const locals = { user: { id: 'u1', role: 'user' }, tenantCtx: { tenantId: 'org-1' } };

    await expect(
      POST!({ locals, params: { id: 'r1' }, request: req({ organizationId: 'org-2' }) } as never),
    ).rejects.toMatchObject({ status: 403 });
    expect(approveRequest).not.toHaveBeenCalled();
  });

  it('platform admin may approve across orgs', async () => {
    requireOrgCapability.mockResolvedValue(null);
    const locals = { user: { id: 'admin1', role: 'admin' }, tenantCtx: { tenantId: 'org-1' } };

    const res = await POST!({
      locals,
      params: { id: 'r1' },
      request: req({ organizationId: 'org-2', role: 'user' }),
    } as never);

    expect(res.status).toBe(200);
    expect(approveRequest).toHaveBeenCalledWith(
      'r1',
      expect.objectContaining({ organizationId: 'org-2' }),
    );
  });
});
