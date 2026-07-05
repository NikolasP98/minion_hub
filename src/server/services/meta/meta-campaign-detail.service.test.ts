// Tests for WP-D additions to meta-insights.service.ts (campaignBreakdown's
// ad-level post/thumbnail join + getCampaignDetail). Kept in a separate file
// from meta-insights.service.test.ts to avoid a vi.mock('$server/db/with-org-core')
// collision with the parallel WP-C work landing in that shared test file —
// both files run under the same `bun run vitest run src/server/services/meta` glob.
import { describe, it, expect, vi } from 'vitest';

// mockWithOrgCore wraps the real module export, defaulting to a passthrough so
// any test that doesn't override it still exercises `scope.db.transaction`.
// Aggregate-only tests (all of these) override it to hand the service a
// stub tx whose `execute` returns canned rows in call order — see
// finance.service.test.ts's `useExecMock` for the pattern this mirrors.
const mockWithOrgCore = vi.fn(
  (scope: { db: { transaction: (fn: (tx: unknown) => Promise<unknown>) => Promise<unknown> }; tenantId: string }, fn: (tx: unknown) => Promise<unknown>) =>
    scope.db.transaction((tx) => fn(tx)),
);

vi.mock('$server/db/with-org-core', () => ({
  withOrgCore: (scope: unknown, fn: (tx: unknown) => Promise<unknown>) => mockWithOrgCore(scope as never, fn),
}));

const ctx = () => ({ db: {} as never, tenantId: 'org-1' });

function useExecMock(execute: ReturnType<typeof vi.fn>) {
  mockWithOrgCore.mockImplementation((_scope, fn) => fn({ execute } as never));
}

describe('campaignBreakdown (ad level)', () => {
  it('exposes postId/thumbFileId from the meta_ad_posts → meta_post_media join', async () => {
    const { campaignBreakdown } = await import('./meta-insights.service');
    const execute = vi.fn().mockResolvedValueOnce([
      {
        campaign_id: 'c1', campaign_name: 'Campaign 1',
        adset_id: 's1', adset_name: 'Set 1',
        ad_id: 'a1', ad_name: 'Ad 1',
        spend: '10.5', impressions: '100', reach: '80', clicks: '5',
        post_id: '1234_5678', thumb_file_id: 'file-abc',
      },
      {
        campaign_id: 'c1', campaign_name: 'Campaign 1',
        adset_id: 's1', adset_name: 'Set 1',
        ad_id: 'a2', ad_name: 'Ad 2 (dark post)',
        spend: '3', impressions: '50', reach: '40', clicks: '1',
        post_id: null, thumb_file_id: null,
      },
    ]);
    useExecMock(execute);

    const rows = await campaignBreakdown(ctx(), { from: '2026-01-01', to: '2026-02-01' }, 'ad');

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ adId: 'a1', postId: '1234_5678', thumbFileId: 'file-abc' });
    expect(rows[1]).toMatchObject({ adId: 'a2', postId: null, thumbFileId: null });
  });

  it('leaves postId/thumbFileId null at campaign level (no join)', async () => {
    const { campaignBreakdown } = await import('./meta-insights.service');
    const execute = vi.fn().mockResolvedValueOnce([
      { campaign_id: 'c1', campaign_name: 'Campaign 1', adset_id: null, adset_name: null, ad_id: null, ad_name: null, spend: '13.5', impressions: '150', reach: '120', clicks: '6' },
    ]);
    useExecMock(execute);

    const rows = await campaignBreakdown(ctx(), { from: '2026-01-01', to: '2026-02-01' }, 'campaign');

    expect(rows[0]).toMatchObject({ campaignId: 'c1', postId: null, thumbFileId: null });
  });
});

describe('getCampaignDetail', () => {
  it('returns null when the campaign has no rows at all (real 404, not empty-range)', async () => {
    const { getCampaignDetail } = await import('./meta-insights.service');
    const execute = vi.fn().mockResolvedValueOnce([]); // existence check
    useExecMock(execute);

    const result = await getCampaignDetail(ctx(), 'missing-campaign', { from: '2026-01-01', to: '2026-02-01' });

    expect(result).toBeNull();
    expect(execute).toHaveBeenCalledTimes(1); // short-circuits after the existence check
  });

  it('assembles header totals, adsets, ads (with post/thumb), and a date-ordered spend series', async () => {
    const { getCampaignDetail } = await import('./meta-insights.service');
    const execute = vi
      .fn()
      // 1. existence check
      .mockResolvedValueOnce([{ campaign_name: 'Campaign 1' }])
      // 2. header totals
      .mockResolvedValueOnce([{ spend: '20', impressions: '200', reach: '150', clicks: '10' }])
      // 3. adset breakdown
      .mockResolvedValueOnce([
        { adset_id: 's1', adset_name: 'Set 1', spend: '20', impressions: '200', reach: '150', clicks: '10' },
      ])
      // 4. ad breakdown (with post/thumb join)
      .mockResolvedValueOnce([
        { ad_id: 'a1', ad_name: 'Ad 1', spend: '20', impressions: '200', reach: '150', clicks: '10', post_id: '1_2', thumb_file_id: 'file-1' },
      ])
      // 5. spend series
      .mockResolvedValueOnce([
        { date: '2026-01-02', spend: '15' },
        { date: '2026-01-01', spend: '5' },
      ]);
    useExecMock(execute);

    const result = await getCampaignDetail(ctx(), 'c1', { from: '2026-01-01', to: '2026-02-01' });

    expect(result).not.toBeNull();
    expect(result?.campaignName).toBe('Campaign 1');
    expect(result?.totals).toMatchObject({ spend: 20, impressions: 200, reach: 150, clicks: 10 });
    expect(result?.totals.ctr).toBeCloseTo(5); // 10/200 * 100
    expect(result?.adsets).toEqual([
      { adsetId: 's1', adsetName: 'Set 1', spend: 20, impressions: 200, reach: 150, clicks: 10, ctr: 5, cpc: 2 },
    ]);
    expect(result?.ads).toEqual([
      { adId: 'a1', adName: 'Ad 1', spend: 20, impressions: 200, reach: 150, clicks: 10, ctr: 5, cpc: 2, postId: '1_2', thumbFileId: 'file-1' },
    ]);
    // spendSeries shape: [{date, spend}], in whatever order the query returned
    // (the service doesn't re-sort in JS — `order by date` is the DB's job).
    expect(result?.spendSeries).toEqual([
      { date: '2026-01-02', spend: 15 },
      { date: '2026-01-01', spend: 5 },
    ]);
  });
});
