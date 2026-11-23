import { beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  upsertAgents: vi.fn(),
  recordInstall: vi.fn(),
  serverScope: vi.fn(),
  insert: vi.fn(),
}));

vi.mock('$app/environment', () => ({ building: false }));
vi.mock('$server/services/entitlements.service', () => ({ requireFeature: vi.fn() }));
vi.mock('@minion-stack/db/schema', () => ({ servers: {} }));
vi.mock('$server/db/utils', () => ({ nowMs: () => 1 }));
vi.mock('$lib/server/posthog', () => ({ captureServerEvent: vi.fn() }));
vi.mock('$server/services/agent.service', () => ({ upsertAgents: mocks.upsertAgents }));
vi.mock('$server/auth/server-scope', () => ({ serverScope: mocks.serverScope }));
vi.mock('$server/auth/tenant-ctx', () => ({
  getTenantCtx: async () => ({
    tenantId: 'org-a',
    db: { insert: () => ({ values: () => ({ onConflictDoNothing: mocks.insert }) }) },
  }),
}));
vi.mock('$server/auth/core-ctx', () => ({
  getCoreCtx: async () => ({ tenantId: 'org-a', db: {} }),
}));
vi.mock('$server/services/marketplace.service', () => ({
  recordInstall: mocks.recordInstall,
  getAgentWithFiles: async () => ({
    id: 'agent-1',
    name: 'Agent',
    tags: '[]',
    documentState: 'ready',
  }),
}));

import { POST } from './+server';

function event(locals: Record<string, unknown> = {}) {
  return {
    locals,
    route: { id: '/api/marketplace/install' },
    request: new Request('http://x', {
      method: 'POST',
      body: JSON.stringify({ agentId: 'agent-1', serverId: 'server-1' }),
    }),
  } as never;
}

describe('POST /api/marketplace/install server scoping', () => {
  beforeEach(() => {
    for (const m of Object.values(mocks)) m.mockReset();
  });

  test.each(['own', 'none'] as const)('server scope %s installs', async (scope) => {
    mocks.serverScope.mockResolvedValue(scope);
    const res = await POST(event());
    expect(res.status).toBe(200);
    expect(mocks.upsertAgents).toHaveBeenCalledOnce();
    expect(mocks.recordInstall).toHaveBeenCalledOnce();
  });

  test("another organization's server id is 404 with no server row, agent or install written", async () => {
    mocks.serverScope.mockResolvedValue('foreign');
    await expect(POST(event())).rejects.toMatchObject({ status: 404 });
    expect(mocks.insert).not.toHaveBeenCalled();
    expect(mocks.upsertAgents).not.toHaveBeenCalled();
    expect(mocks.recordInstall).not.toHaveBeenCalled();
  });

  test('a gateway token for a different server id is 404', async () => {
    mocks.serverScope.mockResolvedValue('foreign');
    await expect(POST(event({ serverId: 'other-server' }))).rejects.toMatchObject({ status: 404 });
    expect(mocks.serverScope).toHaveBeenCalledWith(expect.anything(), 'server-1', 'other-server');
    expect(mocks.upsertAgents).not.toHaveBeenCalled();
  });
});
