import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getCoreCtx: vi.fn(),
  scoreSentimentBatch: vi.fn(),
  refreshSentimentRollupRange: vi.fn(),
  invalidateTags: vi.fn(),
}));

vi.mock('$server/auth/core-ctx', () => ({ getCoreCtx: mocks.getCoreCtx }));
vi.mock('$server/services/crm-insights.service', () => ({
  scoreSentimentBatch: mocks.scoreSentimentBatch,
}));
vi.mock('$server/services/crm-sentiment-rollup.service', () => ({
  refreshSentimentRollupRange: mocks.refreshSentimentRollupRange,
}));
vi.mock('@minion-stack/cache', () => ({
  invalidateTags: mocks.invalidateTags,
  tags: { tenantDomain: (orgId: string, domain: string) => [`${orgId}:${domain}`] },
}));

import { POST } from './+server';

describe('POST /api/crm/insights/sentiment', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCoreCtx.mockResolvedValue({ tenantId: 'org-active' });
    mocks.refreshSentimentRollupRange.mockResolvedValue(2);
  });

  it('refreshes only chat-days affected by the scored batch', async () => {
    mocks.scoreSentimentBatch.mockResolvedValue({
      scored: 7,
      fromDay: '2026-08-20',
      toDay: '2026-08-22',
    });

    const response = await POST({ locals: {} } as never);

    expect(response.status).toBe(200);
    expect(mocks.refreshSentimentRollupRange).toHaveBeenCalledWith(
      '2026-08-20',
      '2026-08-22',
      'org-active',
    );
    expect(mocks.invalidateTags).toHaveBeenCalledWith(['org-active:crm']);
  });

  it('does not rebuild or invalidate rollups for an empty batch', async () => {
    mocks.scoreSentimentBatch.mockResolvedValue({ scored: 0, fromDay: null, toDay: null });

    await POST({ locals: {} } as never);

    expect(mocks.refreshSentimentRollupRange).not.toHaveBeenCalled();
    expect(mocks.invalidateTags).not.toHaveBeenCalled();
  });
});
