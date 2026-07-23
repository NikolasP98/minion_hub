import { beforeEach, describe, expect, it, vi } from 'vitest';

const requireOrgCapability = vi.fn();
const requireCoreCtx = vi.fn();
const resolvePrincipal = vi.fn();
const setFocusedBrainSourceMembership = vi.fn();

vi.mock('$server/services/rbac.service', () => ({ requireOrgCapability }));
vi.mock('$server/auth/core-ctx', () => ({ requireCoreCtx }));
vi.mock('$server/services/brains.service', () => ({ resolvePrincipal }));
vi.mock('$server/services/brain-corpus.service', () => ({ setFocusedBrainSourceMembership }));

const { DELETE, PUT } = await import('./+server');

const brainId = '11111111-1111-4111-8111-111111111111';
const sourceId = '22222222-2222-4222-8222-222222222222';

beforeEach(() => {
  vi.clearAllMocks();
  requireOrgCapability.mockResolvedValue({ roles: ['manager'] });
  requireCoreCtx.mockResolvedValue({ db: {}, tenantId: 'org-1', profileId: 'profile-1' });
  resolvePrincipal.mockResolvedValue({ profileId: 'profile-1', roles: ['manager'] });
  setFocusedBrainSourceMembership.mockImplementation(
    async (_ctx, _brainId, _sourceId, member: boolean) => ({
      sourceId,
      member,
      changed: true,
    }),
  );
});

describe('/api/brains/[id]/sources/[sourceId]', () => {
  it('attaches a source only after the org edit gate and principal resolution', async () => {
    const locals = {
      user: { displayName: 'Ada', email: 'ada@example.com' },
    } as never;
    const response = (await PUT!({
      locals,
      params: { id: brainId, sourceId },
    } as never)) as Response;

    expect(response.status).toBe(200);
    expect(requireOrgCapability).toHaveBeenCalledWith(locals, 'brains', 'edit');
    expect(setFocusedBrainSourceMembership).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'org-1', profileId: 'profile-1' }),
      brainId,
      sourceId,
      true,
      { profileId: 'profile-1', roles: ['manager'] },
      { id: 'profile-1', name: 'Ada' },
    );
  });

  it('detaches only the source reference', async () => {
    const response = (await DELETE!({
      locals: {},
      params: { id: brainId, sourceId },
    } as never)) as Response;

    expect(response.status).toBe(200);
    expect(setFocusedBrainSourceMembership).toHaveBeenCalledWith(
      expect.anything(),
      brainId,
      sourceId,
      false,
      expect.anything(),
      { id: 'profile-1', name: null },
    );
  });

  it('stops before context and mutation when brains:edit is denied', async () => {
    requireOrgCapability.mockRejectedValueOnce({ status: 403 });

    await expect(
      PUT!({ locals: {}, params: { id: brainId, sourceId } } as never),
    ).rejects.toMatchObject({ status: 403 });
    expect(requireCoreCtx).not.toHaveBeenCalled();
    expect(setFocusedBrainSourceMembership).not.toHaveBeenCalled();
  });

  it('fails malformed route ids before resolving a principal or mutating', async () => {
    await expect(
      PUT!({ locals: {}, params: { id: 'not-a-uuid', sourceId } } as never),
    ).rejects.toMatchObject({ status: 404 });
    expect(resolvePrincipal).not.toHaveBeenCalled();
    expect(setFocusedBrainSourceMembership).not.toHaveBeenCalled();
  });

  it('preserves a service-level fail-closed denial', async () => {
    setFocusedBrainSourceMembership.mockRejectedValueOnce({ status: 404 });

    await expect(
      DELETE!({ locals: {}, params: { id: brainId, sourceId } } as never),
    ).rejects.toMatchObject({ status: 404 });
  });
});
