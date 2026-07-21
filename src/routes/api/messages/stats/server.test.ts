import { beforeEach, describe, expect, it, vi } from 'vitest';

const resolveGatewayId = vi.fn();
const getMessageIngestStats = vi.fn();

vi.mock('$server/auth/authorize', () => ({
  requireTenantCtx: () => ({ tenantId: 'org-1' }),
}));
vi.mock('$server/services/gateway.pg.service', () => ({ resolveGatewayId }));
vi.mock('$server/services/messages.service', () => ({ getMessageIngestStats }));

const { GET } = await import('./+server');

function invoke(query: string) {
  return GET!({ locals: {}, url: new URL(`http://localhost/api/messages/stats?${query}`) } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  resolveGatewayId.mockResolvedValue('gateway-uuid');
  getMessageIngestStats.mockResolvedValue({ persisted: 73, latestPersistedAt: 1234 });
});

describe('GET /api/messages/stats', () => {
  it('resolves the selected server and scopes DB stats to org, account, and session', async () => {
    const response = (await invoke(
      'serverId=legacy-server&channel=whatsapp&accountId=%2B51900000000&since=1721000000000',
    )) as Response;

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ persisted: 73, latestPersistedAt: 1234 });
    expect(resolveGatewayId).toHaveBeenCalledWith('legacy-server');
    expect(getMessageIngestStats).toHaveBeenCalledWith('org-1', {
      gatewayId: 'gateway-uuid',
      channel: 'whatsapp',
      accountId: '+51900000000',
      since: 1721000000000,
    });
  });

  it('rejects an invalid session timestamp before querying the database', async () => {
    await expect(
      invoke('serverId=gateway&channel=whatsapp&accountId=default&since=not-a-number'),
    ).rejects.toMatchObject({ status: 400 });
    expect(getMessageIngestStats).not.toHaveBeenCalled();
  });
});
