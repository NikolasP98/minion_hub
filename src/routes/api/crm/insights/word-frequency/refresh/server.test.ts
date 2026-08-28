import { beforeEach, describe, expect, it, vi } from 'vitest';

const refreshCrmInsightsRollups = vi.fn();

vi.mock('$env/dynamic/private', () => ({ env: { CRON_SECRET: 'sekret' } }));
vi.mock('$server/services/crm-insights-rollup-refresh.service', () => ({
  refreshCrmInsightsRollups,
}));

const { GET } = await import('./+server');

beforeEach(() => {
  vi.clearAllMocks();
  refreshCrmInsightsRollups.mockResolvedValue({
    ok: true,
    days: 3,
    wordRows: 123,
    sentimentRows: 45,
  });
});

describe('GET /api/crm/insights/word-frequency/refresh', () => {
  it('rejects calls without the cron bearer secret', async () => {
    await expect(
      GET!({
        request: new Request('https://hub.test/api/crm/insights/word-frequency/refresh'),
        url: new URL('https://hub.test/api/crm/insights/word-frequency/refresh'),
      } as never),
    ).rejects.toMatchObject({ status: 401 });
    expect(refreshCrmInsightsRollups).not.toHaveBeenCalled();
  });

  it('refreshes three days for the frequent incremental cron', async () => {
    const url = new URL('https://hub.test/api/crm/insights/word-frequency/refresh');
    const response = (await GET!({
      request: new Request(url, { headers: { authorization: 'Bearer sekret' } }),
      url,
    } as never)) as Response;
    expect(await response.json()).toEqual({
      ok: true,
      days: 3,
      wordRows: 123,
      sentimentRows: 45,
    });
    expect(refreshCrmInsightsRollups).toHaveBeenCalledWith(3);
  });
});
