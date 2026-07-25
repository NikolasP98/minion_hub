import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  probeArchitecture: vi.fn(),
  requireOrgCapability: vi.fn(),
}));

vi.mock('$server/services/architecture.service', () => ({
  probeArchitecture: mocks.probeArchitecture,
}));

vi.mock('$server/services/rbac.service', () => ({
  requireOrgCapability: mocks.requireOrgCapability,
}));

import { GET } from './+server';

describe('GET /api/reliability/architecture', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.probeArchitecture.mockResolvedValue({ nodes: [] });
  });

  it('probes only the caller active organization', async () => {
    const response = await GET({
      locals: {
        orgId: 'org-active',
        tenantCtx: { tenantId: 'org-fallback' },
      },
    } as never);

    expect(response.status).toBe(200);
    expect(mocks.requireOrgCapability).toHaveBeenCalledWith(
      expect.anything(),
      'reliability',
      'view',
    );
    expect(mocks.probeArchitecture).toHaveBeenCalledWith('org-active');
  });

  it('rejects an unscoped architecture probe', async () => {
    await expect(GET({ locals: {} } as never)).rejects.toMatchObject({
      status: 401,
      body: { message: 'tenant context required' },
    });
    expect(mocks.probeArchitecture).not.toHaveBeenCalled();
  });
});
