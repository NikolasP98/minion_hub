import { beforeEach, describe, expect, it, vi } from 'vitest';

const getMessageIngestStats = vi.fn();

vi.mock('$server/auth/authorize', () => ({
  requireTenantCtx: () => ({ tenantId: 'org-1' }),
}));
vi.mock('$server/services/messages.service', () => ({ getMessageIngestStats }));

const { GET } = await import('./+server');

function invoke(query: string) {
  return GET!({
    locals: {},
    url: new URL(`http://localhost/api/messages/stats?${query}`),
  } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  getMessageIngestStats.mockResolvedValue({ persisted: 73, latestPersistedAt: 1234 });
});

describe('GET /api/messages/stats', () => {
  it('scopes DB stats to the authenticated org, account, and sync session', async () => {
    const response = (await invoke(
      'channel=whatsapp&accountId=%2B51900000000&since=1721000000000',
    )) as Response;

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ persisted: 73, latestPersistedAt: 1234 });
    expect(getMessageIngestStats).toHaveBeenCalledWith('org-1', {
      channel: 'whatsapp',
      accountId: '+51900000000',
      since: 1721000000000,
    });
  });

  it('rejects an invalid session timestamp before querying the database', async () => {
    await expect(
      invoke('channel=whatsapp&accountId=default&since=not-a-number'),
    ).rejects.toMatchObject({ status: 400 });
    expect(getMessageIngestStats).not.toHaveBeenCalled();
  });
});
