import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  cached: vi.fn(),
  wordFrequencyRollup: vi.fn(),
  sentimentByDayRollup: vi.fn(),
  currentSentiment: vi.fn(),
  winIndexStatus: vi.fn(),
  getWinAnalysis: vi.fn(),
  conversationThemes: vi.fn(),
  pendingAnalysisCount: vi.fn(),
}));

vi.mock('@minion-stack/cache', () => ({
  cached: mocks.cached,
  keys: { hub: (domain: string, scope: unknown) => `${domain}:${JSON.stringify(scope)}` },
  tags: { tenantDomain: (orgId: string, domain: string) => [`tenant:${orgId}:${domain}`] },
}));
vi.mock('./crm-insights.service', () => ({
  currentSentiment: mocks.currentSentiment,
}));
vi.mock('./crm-word-frequency-rollup.service', () => ({
  wordFrequencyRollup: mocks.wordFrequencyRollup,
}));
vi.mock('./crm-sentiment-rollup.service', () => ({
  sentimentByDayRollup: mocks.sentimentByDayRollup,
}));
vi.mock('./crm-similarity.service', () => ({
  winIndexStatus: mocks.winIndexStatus,
  getWinAnalysis: mocks.getWinAnalysis,
}));
vi.mock('./crm-conversation-analysis.service', () => ({
  conversationThemes: mocks.conversationThemes,
  pendingAnalysisCount: mocks.pendingAnalysisCount,
}));

import { crmInsightsDashboard } from './crm-insights-dashboard.service';

describe('crmInsightsDashboard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const values = new Map<string, unknown>();
    mocks.cached.mockImplementation(
      async (key: string, _opts: unknown, loader: () => Promise<unknown>) => {
        if (values.has(key)) return values.get(key);
        const value = await loader();
        values.set(key, value);
        return value;
      },
    );
    mocks.wordFrequencyRollup.mockResolvedValue([]);
    mocks.sentimentByDayRollup.mockResolvedValue([]);
    mocks.currentSentiment.mockResolvedValue(null);
    mocks.winIndexStatus.mockResolvedValue({ count: 0, builtAt: null, thin: false });
    mocks.getWinAnalysis.mockResolvedValue(null);
    mocks.conversationThemes.mockResolvedValue({
      topPainPoints: [],
      intentDistribution: [],
      overAnswered: { rate: 0, count: 0, total: 0 },
    });
    mocks.pendingAnalysisCount.mockResolvedValue(0);
  });

  it('uses a stable semantic key so rolling timestamps do not defeat the dashboard cache', async () => {
    const ctx = { tenantId: 'org-a' } as never;
    await crmInsightsDashboard(ctx, {
      range: '90d',
      sentimentGranularity: 'day',
      fromIso: '2026-05-01T12:00:00.000Z',
      toIso: '2026-08-01T12:00:00.000Z',
    });
    await crmInsightsDashboard(ctx, {
      range: '90d',
      sentimentGranularity: 'day',
      fromIso: '2026-05-01T12:04:00.000Z',
      toIso: '2026-08-01T12:04:00.000Z',
    });

    expect(mocks.cached.mock.calls[0][0]).toBe(mocks.cached.mock.calls[1][0]);
    expect(mocks.wordFrequencyRollup).toHaveBeenCalledOnce();
    expect(mocks.conversationThemes).toHaveBeenCalledOnce();
  });

  it('keeps organization and granularity in the cache identity', async () => {
    const common = {
      range: 'all' as const,
      fromIso: '1970-01-01T00:00:00.000Z',
      toIso: '2026-08-01T12:00:00.000Z',
    };
    await crmInsightsDashboard({ tenantId: 'org-a' } as never, {
      ...common,
      sentimentGranularity: 'day',
    });
    await crmInsightsDashboard({ tenantId: 'org-b' } as never, {
      ...common,
      sentimentGranularity: 'week',
    });

    expect(mocks.cached.mock.calls[0][0]).not.toBe(mocks.cached.mock.calls[1][0]);
  });
});
