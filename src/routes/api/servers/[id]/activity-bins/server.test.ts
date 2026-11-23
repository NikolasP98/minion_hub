import { beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  upsertActivityBins: vi.fn(),
  pruneOldActivityBins: vi.fn(),
  serverScope: vi.fn(),
}));

vi.mock('$server/services/activity-bins.service', () => ({
  getActivityBins: vi.fn(),
  upsertActivityBins: mocks.upsertActivityBins,
  pruneOldActivityBins: mocks.pruneOldActivityBins,
}));
vi.mock('$server/auth/server-scope', () => ({ serverScope: mocks.serverScope }));

import { POST } from './+server';

const tenantCtx = { db: {}, tenantId: 'org-a' };
function event(locals: Record<string, unknown> = {}) {
  return {
    locals: { tenantCtx, ...locals },
    params: { id: 'server-1' },
    request: new Request('http://x', {
      method: 'POST',
      body: JSON.stringify({ bins: [{ agentId: 'a1', binTs: 1, count: 2 }] }),
    }),
  } as never;
}

describe('POST /api/servers/[id]/activity-bins', () => {
  beforeEach(() => {
    mocks.upsertActivityBins.mockReset();
    mocks.pruneOldActivityBins.mockReset();
    mocks.serverScope.mockReset();
  });

  test("writes for a server in the caller's organization", async () => {
    mocks.serverScope.mockResolvedValue('own');
    expect((await POST(event())).status).toBe(200);
    expect(mocks.upsertActivityBins).toHaveBeenCalledWith(tenantCtx, 'server-1', [
      { agentId: 'a1', binTs: 1, count: 2 },
    ]);
  });

  test("another organization's server id is 404 and nothing is written or pruned", async () => {
    mocks.serverScope.mockResolvedValue('foreign');
    expect((await POST(event())).status).toBe(404);
    expect(mocks.upsertActivityBins).not.toHaveBeenCalled();
    expect(mocks.pruneOldActivityBins).not.toHaveBeenCalled();
  });

  test('a gateway token for a different server is 404', async () => {
    mocks.serverScope.mockResolvedValue('foreign');
    expect((await POST(event({ serverId: 'other-server' }))).status).toBe(404);
    expect(mocks.serverScope).toHaveBeenCalledWith(tenantCtx, 'server-1', 'other-server');
    expect(mocks.upsertActivityBins).not.toHaveBeenCalled();
  });
});
