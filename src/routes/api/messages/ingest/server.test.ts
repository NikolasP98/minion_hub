import { beforeEach, describe, expect, it, vi } from 'vitest';

const insertMessagesDetailed = vi.fn();
const applyRoutingPatches = vi.fn();

vi.mock('$server/services/messages.service', () => ({
  insertMessagesDetailed,
  applyRoutingPatches,
}));

const { POST } = await import('./+server');

beforeEach(() => {
  vi.clearAllMocks();
  insertMessagesDetailed.mockResolvedValue({ accepted: 1, acceptedClientIds: ['client-1'] });
  applyRoutingPatches.mockResolvedValue(undefined);
});

describe('POST /api/messages/ingest', () => {
  it('returns exact row and patch client acknowledgements', async () => {
    const rows = [{ clientId: 'client-1' }];
    const patches = [{ clientId: 'patch-1', agentId: 'agent-1', sessionKey: 'session-1' }];
    const response = (await POST!({
      locals: {
        tenantCtx: { tenantId: 'org-1' },
        serverId: 'gateway-1',
      },
      request: new Request('http://localhost/api/messages/ingest', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ rows, patches }),
      }),
    } as never)) as Response;

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      accepted: 1,
      acceptedClientIds: ['client-1'],
      patched: 1,
      patchedClientIds: ['patch-1'],
    });
    expect(insertMessagesDetailed).toHaveBeenCalledWith('org-1', 'gateway-1', rows);
    expect(applyRoutingPatches).toHaveBeenCalledWith('org-1', patches);
  });
});
