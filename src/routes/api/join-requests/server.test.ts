import { beforeEach, describe, expect, it, vi } from 'vitest';

const requireOrgCapability = vi.fn();
const listPendingRequests = vi.fn();
const createRequest = vi.fn();
const listAllOrganizations = vi.fn();
const requireAuth = vi.fn();
const sdk = vi.hoisted(() => ({ env: {} as Record<string, string | undefined> }));

vi.mock('$env/dynamic/public', () => ({ env: sdk.env }));
vi.mock('$server/services/rbac.service', () => ({ requireOrgCapability }));
vi.mock('$server/services/join/requests.service', () => ({ createRequest, listPendingRequests }));
vi.mock('$server/services/organizations.service', () => ({ listAllOrganizations }));
vi.mock('$server/auth/authorize', () => ({ requireAuth }));

const { GET, POST } = await import('./+server');

const postReq = (body: Record<string, unknown>) =>
  new Request('http://localhost/api/join-requests', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

beforeEach(() => {
  vi.clearAllMocks();
  for (const k of Object.keys(sdk.env)) delete sdk.env[k];
  listPendingRequests.mockResolvedValue([]);
  requireAuth.mockReturnValue({
    id: 'u1',
    supabaseId: 'sb-1',
    email: 'a@b.c',
    displayName: 'A',
  });
  createRequest.mockResolvedValue({ id: 'r1', status: 'pending' });
  listAllOrganizations.mockResolvedValue([
    { id: 'org-a', name: 'A Org', slug: 'a-org' },
    { id: 'org-b', name: 'B Org', slug: 'b-org' },
  ]);
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

describe('POST /api/join-requests', () => {
  it('resolves the org by PUBLIC_DEFAULT_ORG_SLUG when set', async () => {
    sdk.env.PUBLIC_DEFAULT_ORG_SLUG = 'b-org';
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const res = await POST!({ locals: {}, request: postReq({ message: 'hi' }) } as never);

    expect(res.status).toBe(200);
    expect(createRequest).toHaveBeenCalledWith(expect.anything(), 'org-b', 'hi');
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('falls back to the first org alphabetically and warns when the slug is unset', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await POST!({ locals: {}, request: postReq({}) } as never);

    expect(createRequest).toHaveBeenCalledWith(expect.anything(), 'org-a', undefined);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('PUBLIC_DEFAULT_ORG_SLUG is not set'),
    );
    warn.mockRestore();
  });

  it('falls back to the first org alphabetically and warns when the slug matches no org', async () => {
    sdk.env.PUBLIC_DEFAULT_ORG_SLUG = 'does-not-exist';
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await POST!({ locals: {}, request: postReq({}) } as never);

    expect(createRequest).toHaveBeenCalledWith(expect.anything(), 'org-a', undefined);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('matched no organization'));
    warn.mockRestore();
  });

  it('500s when no organization exists at all', async () => {
    listAllOrganizations.mockResolvedValueOnce([]);

    await expect(POST!({ locals: {}, request: postReq({}) } as never)).rejects.toMatchObject({
      status: 500,
    });
    expect(createRequest).not.toHaveBeenCalled();
  });
});
