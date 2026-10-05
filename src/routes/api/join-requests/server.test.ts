import { beforeEach, describe, expect, it, vi } from 'vitest';

const requireOrgCapability = vi.fn();
const listPendingRequests = vi.fn();
const createRequest = vi.fn();
const resolveJoinRequestTarget = vi.fn();
const requireAuth = vi.fn();
const sdk = vi.hoisted(() => ({ env: {} as Record<string, string | undefined> }));

vi.mock('$env/dynamic/public', () => ({ env: sdk.env }));
vi.mock('$server/services/rbac.service', () => ({ requireOrgCapability }));
vi.mock('$server/services/join/requests.service', () => ({ createRequest, listPendingRequests }));
vi.mock('$server/services/join/request-target', () => ({ resolveJoinRequestTarget }));
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
  resolveJoinRequestTarget.mockResolvedValue({ id: 'org-b' });
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
  it('uses the exact server-resolved target and authenticated applicant', async () => {
    const res = await POST!({ locals: {}, request: postReq({ message: 'hi' }) } as never);
    expect(res.status).toBe(200);
    expect(createRequest).toHaveBeenCalledWith(
      { id: 'u1', supabaseId: 'sb-1', email: 'a@b.c', displayName: 'A' },
      'org-b',
      'hi',
    );
  });
  it('fails unavailable without creating a request when the configured target is ambiguous', async () => {
    resolveJoinRequestTarget.mockRejectedValueOnce({ status: 503 });
    await expect(POST!({ locals: {}, request: postReq({}) } as never)).rejects.toMatchObject({
      status: 503,
    });
    expect(createRequest).not.toHaveBeenCalled();
  });
  it.each([
    { organizationId: 'foreign' },
    { userId: 'other' },
    { message: 1 },
    { message: 'x'.repeat(501) },
  ])('rejects caller authority and invalid messages %j', async (body) => {
    await expect(POST!({ locals: {}, request: postReq(body) } as never)).rejects.toMatchObject({
      status: 400,
    });
    expect(createRequest).not.toHaveBeenCalled();
  });
  it('rejects oversized unlabelled body before target resolution', async () => {
    await expect(
      POST!({ locals: {}, request: postReq({ message: 'x'.repeat(5000) }) } as never),
    ).rejects.toMatchObject({ status: 413 });
    expect(resolveJoinRequestTarget).not.toHaveBeenCalled();
    expect(createRequest).not.toHaveBeenCalled();
  });
  it('rejects malformed JSON instead of admitting an empty request', async () => {
    await expect(
      POST!({
        locals: {},
        request: new Request('http://localhost', { method: 'POST', body: '{' }),
      } as never),
    ).rejects.toMatchObject({ status: 400 });
    expect(createRequest).not.toHaveBeenCalled();
  });
});
