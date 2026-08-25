import { beforeEach, describe, expect, it, vi } from 'vitest';

const refreshWordFrequencyRollup = vi.fn();
const refreshSentimentRollup = vi.fn();

vi.mock('$env/dynamic/private', () => ({ env: { CRON_SECRET: 'sekret' } }));
vi.mock('$server/services/crm-word-frequency-rollup.service', () => ({
  refreshWordFrequencyRollup,
}));
vi.mock('$server/services/crm-sentiment-rollup.service', () => ({
  refreshSentimentRollup,
}));

const { GET } = await import('./+server');

beforeEach(() => {
  vi.clearAllMocks();
  refreshWordFrequencyRollup.mockResolvedValue(123);
  refreshSentimentRollup.mockResolvedValue(45);
});

describe('GET /api/crm/insights/word-frequency/refresh', () => {
  it('rejects calls without the cron bearer secret', async () => {
    await expect(
      GET!({
        request: new Request('https://hub.test/api/crm/insights/word-frequency/refresh'),
        url: new URL('https://hub.test/api/crm/insights/word-frequency/refresh'),
      } as never),
    ).rejects.toMatchObject({ status: 401 });
    expect(refreshWordFrequencyRollup).not.toHaveBeenCalled();
    expect(refreshSentimentRollup).not.toHaveBeenCalled();
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
    expect(refreshWordFrequencyRollup).toHaveBeenCalledWith(3);
    expect(refreshSentimentRollup).toHaveBeenCalledWith(3);
  });

  it('refreshes the full retained history for the nightly repair cron', async () => {
    const url = new URL('https://hub.test/api/crm/insights/word-frequency/refresh');
    await GET!({
      request: new Request(url, {
        headers: {
          authorization: 'Bearer sekret',
          'x-vercel-cron-schedule': '15 8 * * *',
        },
      }),
      url,
    } as never);
    expect(refreshWordFrequencyRollup).toHaveBeenCalledWith(4_000);
    expect(refreshSentimentRollup).toHaveBeenCalledWith(4_000);
  });
});
