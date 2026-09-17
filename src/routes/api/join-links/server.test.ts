import { beforeEach, describe, expect, it, vi } from 'vitest';

const requireOrgCapability = vi.fn();
const createLink = vi.fn();
const listLinks = vi.fn();

vi.mock('$server/services/rbac.service', () => ({ requireOrgCapability }));
vi.mock('$server/services/join/links.service', () => ({ createLink, listLinks }));

const { POST, GET } = await import('./+server');

const postReq = (body: Record<string, unknown>) =>
  new Request('http://localhost/api/join-links', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

const url = new URL('http://localhost/api/join-links');

beforeEach(() => {
  vi.clearAllMocks();
  createLink.mockResolvedValue({ id: 'l1', token: 't1' });
  listLinks.mockResolvedValue([]);
});

describe('POST /api/join-links', () => {
  it('org owner mints a link for their own active org (organizationId defaulted)', async () => {
    requireOrgCapability.mockResolvedValue({ can: () => true });
    const locals = { user: { id: 'u1', role: 'user' }, tenantCtx: { tenantId: 'org-1' } };

    const res = await POST!({ locals, request: postReq({ role: 'member' }), url } as never);

    expect(res.status).toBe(200);
    expect(requireOrgCapability).toHaveBeenCalledWith(locals, 'users', 'manage');
    expect(createLink).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: 'org-1', createdBy: 'u1' }),
    );
  });

  it('viewer is rejected before any write', async () => {
    requireOrgCapability.mockRejectedValueOnce({ status: 403 });
    const locals = { user: { id: 'u2', role: 'user' }, tenantCtx: { tenantId: 'org-1' } };

    await expect(
      POST!({
        locals,
        request: postReq({ organizationId: 'org-1', role: 'member' }),
        url,
      } as never),
    ).rejects.toMatchObject({ status: 403 });
    expect(createLink).not.toHaveBeenCalled();
  });

  it('cross-org body.organizationId is rejected for a non-platform-admin', async () => {
    requireOrgCapability.mockResolvedValue({ can: () => true });
    const locals = { user: { id: 'u1', role: 'user' }, tenantCtx: { tenantId: 'org-1' } };

    await expect(
      POST!({
        locals,
        request: postReq({ organizationId: 'org-2', role: 'member' }),
        url,
      } as never),
    ).rejects.toMatchObject({ status: 403 });
    expect(createLink).not.toHaveBeenCalled();
  });

  it('platform admin may target an explicit org', async () => {
    requireOrgCapability.mockResolvedValue(null); // admin bypass
    const locals = { user: { id: 'admin1', role: 'admin' }, tenantCtx: { tenantId: 'org-1' } };

    const res = await POST!({
      locals,
      request: postReq({ organizationId: 'org-2', role: 'member' }),
      url,
    } as never);

    expect(res.status).toBe(200);
    expect(createLink).toHaveBeenCalledWith(expect.objectContaining({ organizationId: 'org-2' }));
  });
});

describe('GET /api/join-links', () => {
  it('lists only the caller tenant links', async () => {
    requireOrgCapability.mockResolvedValue({ can: () => true });
    const locals = { user: { id: 'u1', role: 'user' }, tenantCtx: { tenantId: 'org-1' } };

    await GET!({ locals } as never);

    expect(listLinks).toHaveBeenCalledWith('org-1');
  });

  it('viewer is rejected', async () => {
    requireOrgCapability.mockRejectedValueOnce({ status: 403 });
    const locals = { user: { id: 'u2', role: 'user' }, tenantCtx: { tenantId: 'org-1' } };

    await expect(GET!({ locals } as never)).rejects.toMatchObject({ status: 403 });
    expect(listLinks).not.toHaveBeenCalled();
  });
});
