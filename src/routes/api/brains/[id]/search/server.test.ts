import { beforeEach, describe, expect, it, vi } from 'vitest';

const requireOrgCapability = vi.fn();
const getCoreCtx = vi.fn();
const resolvePrincipal = vi.fn();
const searchBrainHybrid = vi.fn();

vi.mock('$server/services/rbac.service', () => ({ requireOrgCapability }));
vi.mock('$server/auth/core-ctx', () => ({ getCoreCtx }));
vi.mock('$server/services/brains.service', () => ({ resolvePrincipal }));
vi.mock('$server/services/brain-hybrid-retrieval.service', () => ({ searchBrainHybrid }));

const { POST } = await import('./+server');

beforeEach(() => {
  vi.clearAllMocks();
  requireOrgCapability.mockResolvedValue(null);
  getCoreCtx.mockResolvedValue({ db: {}, tenantId: 'org-1', profileId: 'profile-1' });
  resolvePrincipal.mockResolvedValue({ profileId: 'profile-1', roles: ['viewer'] });
  searchBrainHybrid.mockResolvedValue({ mode: 'hybrid', hits: [], diagnostics: {} });
});

describe('POST /api/brains/[id]/search', () => {
  it('requires brains:view and not brains:edit', async () => {
    const request = new Request(
      'http://localhost/api/brains/11111111-1111-4111-8111-111111111111/search',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ query: 'refund policy' }),
      },
    );

    const response = (await POST!({
      locals: {},
      params: { id: '11111111-1111-4111-8111-111111111111' },
      request,
    } as never)) as Response;

    expect(response.status).toBe(200);
    expect(requireOrgCapability).toHaveBeenCalledWith({}, 'brains', 'view');
    expect(searchBrainHybrid).toHaveBeenCalledOnce();
  });

  it('stops before retrieval when brains:view is denied', async () => {
    requireOrgCapability.mockRejectedValueOnce({ status: 403 });

    await expect(
      POST!({
        locals: {},
        params: { id: '11111111-1111-4111-8111-111111111111' },
        request: new Request('http://localhost/api/brains/x/search', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ query: 'refund policy' }),
        }),
      } as never),
    ).rejects.toMatchObject({ status: 403 });
    expect(searchBrainHybrid).not.toHaveBeenCalled();
  });
});
