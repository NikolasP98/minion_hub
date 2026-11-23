import { beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  upsertAgents: vi.fn(),
  serverScope: vi.fn(),
}));

vi.mock('$server/services/agent.service', () => ({
  listAgentsForUser: vi.fn(),
  upsertAgents: mocks.upsertAgents,
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
      body: JSON.stringify({ agents: [{ id: 'a1', name: 'A' }] }),
    }),
  } as never;
}

describe('POST /api/servers/[id]/agents', () => {
  beforeEach(() => {
    mocks.upsertAgents.mockReset();
    mocks.serverScope.mockReset();
  });

  test("writes for a server in the caller's organization", async () => {
    mocks.serverScope.mockResolvedValue('own');
    const res = await POST(event());
    expect(res.status).toBe(200);
    expect(mocks.upsertAgents).toHaveBeenCalledWith(tenantCtx, 'server-1', [
      { id: 'a1', name: 'A' },
    ]);
  });

  test("another organization's server id is 404 and nothing is written", async () => {
    mocks.serverScope.mockResolvedValue('foreign');
    const res = await POST(event());
    expect(res.status).toBe(404);
    expect(mocks.upsertAgents).not.toHaveBeenCalled();
  });

  test('a nonexistent server id is 404 and nothing is written', async () => {
    mocks.serverScope.mockResolvedValue('none');
    expect((await POST(event())).status).toBe(404);
    expect(mocks.upsertAgents).not.toHaveBeenCalled();
  });

  test('a gateway token for a different server id is 404', async () => {
    mocks.serverScope.mockResolvedValue('foreign');
    const res = await POST(event({ serverId: 'other-server' }));
    expect(mocks.serverScope).toHaveBeenCalledWith(tenantCtx, 'server-1', 'other-server');
    expect(res.status).toBe(404);
    expect(mocks.upsertAgents).not.toHaveBeenCalled();
  });
});
