import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getPerformanceSnapshot: vi.fn(),
  requireOrgCapability: vi.fn(),
}));

vi.mock('$server/services/performance-monitor.service', () => ({
  getPerformanceSnapshot: mocks.getPerformanceSnapshot,
}));

vi.mock('$server/services/rbac.service', () => ({
  requireOrgCapability: mocks.requireOrgCapability,
}));

import { GET } from './+server';

describe('GET /api/reliability/performance', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getPerformanceSnapshot.mockResolvedValue({ available: true, routes: [] });
  });

  it('gates the endpoint and scopes the requested range to the active organization', async () => {
    const from = Date.now() - 60_000;
    const to = Date.now();
    const response = await GET({
      locals: { user: { role: 'admin' }, orgId: 'org-active' },
      url: new URL(`https://hub.test/api/reliability/performance?from=${from}&to=${to}`),
    } as never);

    expect(response.status).toBe(200);
    expect(mocks.requireOrgCapability).toHaveBeenCalledWith(
      expect.anything(),
      'reliability',
      'view',
    );
    expect(mocks.getPerformanceSnapshot).toHaveBeenCalledWith('org-active', { from, to });
  });

  it('rejects invalid or over-wide date ranges', async () => {
    await expect(
      GET({
        locals: { user: { role: 'admin' }, orgId: 'org-active' },
        url: new URL('https://hub.test/api/reliability/performance?from=1&to=9999999999999'),
      } as never),
    ).rejects.toMatchObject({ status: 400 });
    expect(mocks.getPerformanceSnapshot).not.toHaveBeenCalled();
  });
});
