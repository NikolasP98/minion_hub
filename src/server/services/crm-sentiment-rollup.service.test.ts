import { beforeEach, describe, expect, it, vi } from 'vitest';

const execute = vi.fn();
vi.mock('$server/db/pg-client', () => ({ getCoreDb: () => ({ execute }) }));
vi.mock('$server/db/with-org-core', () => ({ withOrgCore: vi.fn() }));
vi.mock('./crm-insights.service', () => ({ toSentimentGranularity: () => 'day' }));

import { refreshSentimentRollup, refreshSentimentRollupDays } from './crm-sentiment-rollup.service';

describe('refreshSentimentRollupDays', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    execute.mockResolvedValue([{ refreshed: 1 }]);
  });

  it('keeps sparse affected days in separate bounded refresh ranges', async () => {
    const refreshed = await refreshSentimentRollupDays(
      ['2026-08-22', '2026-05-01', '2026-08-21'],
      'org-a',
    );

    expect(refreshed).toBe(2);
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it('fans the scheduled refresh out by organization instead of scanning globally', async () => {
    execute
      .mockResolvedValueOnce([{ org_id: 'org-a' }, { org_id: 'org-b' }])
      .mockResolvedValueOnce([{ refreshed: 3 }])
      .mockResolvedValueOnce([{ refreshed: 4 }]);

    await expect(refreshSentimentRollup(3)).resolves.toBe(7);
    expect(execute).toHaveBeenCalledTimes(3);
  });
});
