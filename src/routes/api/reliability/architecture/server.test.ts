import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  probeArchitecture: vi.fn(),
  requireAuth: vi.fn(),
  requireFreshReliabilityMember: vi.fn(),
  withAdmission: vi.fn(),
}));

vi.mock('$server/services/architecture.service', () => ({
  probeArchitecture: mocks.probeArchitecture,
}));
vi.mock('$server/auth/authorize', () => ({ requireAuth: mocks.requireAuth }));
vi.mock('$server/services/reliability-read-authority', () => ({
  requireFreshReliabilityMember: mocks.requireFreshReliabilityMember,
}));
vi.mock('$server/services/reliability-read-admission', () => ({
  withReliabilityReadAdmission: mocks.withAdmission,
}));

import { GET } from './+server';

describe('GET /api/reliability/architecture', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAuth.mockReturnValue({ supabaseId: 'actor-id' });
    mocks.requireFreshReliabilityMember.mockResolvedValue({
      profileId: 'actor-id',
      orgId: 'org-active',
    });
    mocks.probeArchitecture.mockResolvedValue({ nodes: [], edges: [], c4: {}, checkedAt: 1 });
    mocks.withAdmission.mockImplementation(
      async (_key: string, work: (s: AbortSignal) => unknown) => work(new AbortController().signal),
    );
  });

  it('uses fresh membership and admission before probing only the active organization', async () => {
    const response = await GET({
      locals: { orgId: 'org-active' },
      url: new URL('https://hub.test/api/reliability/architecture'),
    } as never);

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(mocks.requireFreshReliabilityMember).toHaveBeenCalledWith({
      profileId: 'actor-id',
      orgId: 'org-active',
    });
    expect(mocks.withAdmission).toHaveBeenCalledWith(
      JSON.stringify(['organization', 'actor-id', 'org-active']),
      expect.any(Function),
    );
    expect(mocks.probeArchitecture).toHaveBeenCalledWith('org-active', expect.any(AbortSignal));
  });

  it('rejects query parameters and removed membership before probes start', async () => {
    await expect(
      GET({
        locals: { orgId: 'org-active' },
        url: new URL('https://hub.test/api/reliability/architecture?serverId=foreign'),
      } as never),
    ).rejects.toMatchObject({ status: 400 });
    expect(mocks.requireFreshReliabilityMember).not.toHaveBeenCalled();

    mocks.requireFreshReliabilityMember.mockRejectedValueOnce(
      Object.assign(new Error('private'), { status: 403, code: 'membership_required' }),
    );
    await expect(
      GET({
        locals: { orgId: 'org-active' },
        url: new URL('https://hub.test/api/reliability/architecture'),
      } as never),
    ).rejects.toMatchObject({ status: 403 });
    expect(mocks.withAdmission).toHaveBeenCalledOnce();
    expect(mocks.probeArchitecture).not.toHaveBeenCalled();
  });
});
