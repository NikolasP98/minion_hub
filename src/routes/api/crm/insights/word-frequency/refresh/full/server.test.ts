import { beforeEach, describe, expect, it, vi } from 'vitest';

const refreshCrmInsightsRollups = vi.hoisted(() => vi.fn());
vi.mock('$env/dynamic/private', () => ({ env: { CRON_SECRET: 'sekret' } }));
vi.mock('$server/services/crm-insights-rollup-refresh.service', () => ({
  refreshCrmInsightsRollups,
}));

import { GET } from './+server';

describe('GET /api/crm/insights/word-frequency/refresh/full', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    refreshCrmInsightsRollups.mockResolvedValue({
      ok: true,
      days: 4_000,
      wordRows: 123,
      sentimentRows: 45,
    });
  });

  it('requires the cron bearer and runs the bounded nightly repair', async () => {
    const url = new URL('https://hub.test/api/crm/insights/word-frequency/refresh/full');
    await expect(GET({ request: new Request(url) } as never)).rejects.toMatchObject({
      status: 401,
    });

    const response = (await GET({
      request: new Request(url, { headers: { authorization: 'Bearer sekret' } }),
    } as never)) as Response;
    expect(response.status).toBe(200);
    expect(refreshCrmInsightsRollups).toHaveBeenCalledWith(4_000);
  });
});
