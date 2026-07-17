import { describe, it, expect } from 'vitest';
import { createMockDb } from '$server/test-utils/mock-db';
import { previousRange, deltaPct, calcCtr, calcCpc, extentToRange, getPostDetail } from './meta-insights.service';

const ctx = (db: unknown) => ({ db: db as never, tenantId: 'org-1' });

function rawSqlDb(...queryResults: unknown[]) {
  let executeCount = 0;
  const tx = {
    execute: async () => {
      executeCount += 1;
      // withOrgCore's four SET LOCAL / set_config statements precede service queries.
      if (executeCount <= 4) return undefined;
      return queryResults[executeCount - 5] ?? [];
    },
  };
  return {
    transaction: async (callback: (transaction: typeof tx) => Promise<unknown>) => callback(tx),
  };
}

describe('previousRange', () => {
  it('returns the equal-length window immediately before range', () => {
    expect(previousRange({ from: '2026-06-01', to: '2026-07-01' })).toEqual({
      from: '2026-05-02',
      to: '2026-06-01',
    });
  });

  it('handles single-day ranges', () => {
    expect(previousRange({ from: '2026-07-01', to: '2026-07-02' })).toEqual({
      from: '2026-06-30',
      to: '2026-07-01',
    });
  });
});

describe('deltaPct', () => {
  it('computes percent change', () => {
    expect(deltaPct(150, 100)).toBe(50);
    expect(deltaPct(50, 100)).toBe(-50);
  });
  it('returns null when there is no previous baseline but current is nonzero', () => {
    expect(deltaPct(10, 0)).toBeNull();
  });
  it('returns 0 when both are zero', () => {
    expect(deltaPct(0, 0)).toBe(0);
  });
});

describe('calcCtr / calcCpc', () => {
  it('computes ctr as percent of impressions', () => {
    expect(calcCtr(10, 1000)).toBeCloseTo(1);
  });
  it('returns 0 ctr with no impressions', () => {
    expect(calcCtr(10, 0)).toBe(0);
  });
  it('computes cpc as spend per click', () => {
    expect(calcCpc(50, 25)).toBe(2);
  });
  it('returns 0 cpc with no clicks', () => {
    expect(calcCpc(50, 0)).toBe(0);
  });
});

describe('extentToRange', () => {
  const now = new Date('2026-07-04T12:00:00Z');

  it('spans the full extent, to exclusive (maxDate + 1 day)', () => {
    expect(extentToRange({ minDate: '2026-04-01', maxDate: '2026-04-06' }, now)).toEqual({
      from: '2026-04-01',
      to: '2026-04-07',
    });
  });

  it('falls back to the last 30 days ending today when there is no data yet', () => {
    expect(extentToRange({ minDate: null, maxDate: null }, now)).toEqual({
      from: '2026-06-04',
      to: '2026-07-04',
    });
  });
});

describe('getPostDetail', () => {
  it('returns null when the post has no rows (missing or foreign org)', async () => {
    const { db, resolve } = createMockDb();
    resolve([]);
    expect(await getPostDetail(ctx(db), 'missing-post')).toBeNull();
  });

  it('pivots every metric row, the mirrored thumbnail, and the promoted-by-ad reverse lookup', async () => {
    const { db, resolve } = createMockDb();
    resolve([
      {
        post_id: 'post-1',
        platform: 'fb',
        permalink: 'https://facebook.com/post-1',
        caption: 'Full caption text\nwith a newline',
        posted_at: '2026-06-01T00:00:00.000Z',
        media_type: 'video',
        is_promoted: true,
        metrics: { post_impressions: '120', post_clicks: '5', post_reactions_by_type_total: '30' },
        thumb_file_id: 'file-1',
        thumb_status: 'mirrored',
        promoted_by_ad_ids: 'ad-1,ad-2',
      },
    ]);
    const detail = await getPostDetail(ctx(db), 'post-1');
    expect(detail).toEqual({
      postId: 'post-1',
      platform: 'fb',
      permalink: 'https://facebook.com/post-1',
      caption: 'Full caption text\nwith a newline',
      mediaType: 'video',
      postedAt: '2026-06-01T00:00:00.000Z',
      isPromoted: true,
      metrics: { post_impressions: 120, post_clicks: 5, post_reactions_by_type_total: 30 },
      thumbFileId: 'file-1',
      thumbStatus: 'mirrored',
      promotedByAdIds: ['ad-1', 'ad-2'],
    });
  });

  it('returns an empty promotedByAdIds array for an organic (non-promoted) post', async () => {
    const { db, resolve } = createMockDb();
    resolve([
      {
        post_id: 'post-2',
        platform: 'ig',
        permalink: null,
        caption: null,
        posted_at: null,
        media_type: 'IMAGE',
        is_promoted: false,
        metrics: { likes: '3' },
        thumb_file_id: null,
        thumb_status: null,
        promoted_by_ad_ids: null,
      },
    ]);
    const detail = await getPostDetail(ctx(db), 'post-2');
    expect(detail?.isPromoted).toBe(false);
    expect(detail?.promotedByAdIds).toEqual([]);
    expect(detail?.thumbFileId).toBeNull();
  });

  it('falls back to linked ad aggregates for a dark post', async () => {
    const db = rawSqlDb([], [
      {
        post_id: 'dark-post-1',
        platform: 'fb',
        promoted_by_ad_ids: 'ad-1,ad-2',
        spend: 75.5,
        impressions: 5000,
        reach: 4200,
        clicks: 125,
        campaign_id: 'campaign-1',
        campaign_name: 'Winter launch',
        ad_names: ['Dark creative A', 'Dark creative B'],
        first_date: '2026-06-01',
        last_date: '2026-06-10',
        thumb_file_id: 'file-dark-1',
        thumb_status: 'mirrored',
      },
    ]);

    const detail = await getPostDetail(ctx(db), 'dark-post-1');

    expect(detail).toEqual({
      postId: 'dark-post-1',
      platform: 'fb',
      permalink: null,
      caption: null,
      mediaType: null,
      postedAt: null,
      isPromoted: true,
      metrics: {},
      thumbFileId: 'file-dark-1',
      thumbStatus: 'mirrored',
      promotedByAdIds: ['ad-1', 'ad-2'],
      isDarkPost: true,
      ad: {
        spend: 75.5,
        impressions: 5000,
        reach: 4200,
        clicks: 125,
        ctr: 2.5,
        cpc: 0.604,
        adNames: ['Dark creative A', 'Dark creative B'],
        campaignId: 'campaign-1',
        campaignName: 'Winter launch',
        firstDate: '2026-06-01',
        lastDate: '2026-06-10',
      },
    });
  });

  it('returns null after both the organic and dark-post lookups miss', async () => {
    const db = rawSqlDb([], []);
    expect(await getPostDetail(ctx(db), 'truly-unknown')).toBeNull();
  });
});
