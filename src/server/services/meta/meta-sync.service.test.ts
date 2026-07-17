import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockDb } from '$server/test-utils/mock-db';
import { metaAdPosts, type MetaAsset, type MetaSyncJob } from '$server/db/pg-meta-schema';
import type { GraphResult, PagePost, MetricInsight } from './graph-read';

// ---------------------------------------------------------------------------
// Mocks for the runJob() integration tests further down. Hoisted by vitest,
// so they apply to the whole file — the pure-function tests above/below don't
// touch these modules and are unaffected.
// ---------------------------------------------------------------------------

const listConnections = vi.fn();
const listAssets = vi.fn();
vi.mock('./meta-connections.service', () => ({
  listConnections: (...a: unknown[]) => listConnections(...a),
  listAssets: (...a: unknown[]) => listAssets(...a),
}));

const claimJob = vi.fn<() => Promise<boolean>>();
const getJobById = vi.fn();
const recordProgress = vi.fn<(...a: unknown[]) => Promise<void>>(async () => {});
const requeue = vi.fn<(...a: unknown[]) => Promise<void>>(async () => {});
const finishJob = vi.fn<(...a: unknown[]) => Promise<void>>(async () => {});
vi.mock('./meta-sync-jobs.service', () => ({
  claimJob: () => claimJob(),
  getJobById: () => getJobById(),
  recordProgress: (...a: unknown[]) => recordProgress(...a),
  requeue: (...a: unknown[]) => requeue(...a),
  finishJob: (...a: unknown[]) => finishJob(...a),
}));

const listPagePosts = vi.fn<(...a: unknown[]) => Promise<GraphResult<PagePost[]>>>();
const postInsights = vi.fn<(...a: unknown[]) => Promise<GraphResult<MetricInsight[]>>>();
const igMediaInsights = vi.fn();
const listIgMedia = vi.fn();
const listAdsWithStoryIds =
  vi.fn<
    (...a: unknown[]) => Promise<GraphResult<Array<{ adId: string; storyId: string | null; thumbnailUrl?: string | null }>>>
  >();
const adInsightsMock = vi.fn();
const listConversations = vi.fn();
const fetchNextPage = vi.fn();
vi.mock('./graph-read', async (orig) => {
  const real = (await orig()) as Record<string, unknown>;
  return {
    ...real,
    listPagePosts: (...a: unknown[]) => listPagePosts(...a),
    postInsights: (...a: unknown[]) => postInsights(...a),
    igMediaInsights: (...a: unknown[]) => igMediaInsights(...a),
    listIgMedia: (...a: unknown[]) => listIgMedia(...a),
    listAdsWithStoryIds: (...a: unknown[]) => listAdsWithStoryIds(...a),
    adInsights: (...a: unknown[]) => adInsightsMock(...a),
    listConversations: (...a: unknown[]) => listConversations(...a),
    fetchNextPage: (...a: unknown[]) => fetchNextPage(...a),
  };
});

vi.mock('../messages.service', () => ({ insertMessages: vi.fn(async () => 0) }));
vi.mock('$server/auth/crypto', () => ({ decrypt: (ciphertext: string) => ciphertext, encrypt: vi.fn() }));

// ---------------------------------------------------------------------------
// Mocks for the thumbnail-mirror-pass tests (spec
// 2026-07-05-meta-post-thumbnail-mirroring.md WP3).
// ---------------------------------------------------------------------------

const recordPostMedia = vi.fn<(...a: unknown[]) => Promise<void>>(async () => {});
const claimPendingMedia = vi.fn<(...a: unknown[]) => Promise<unknown[]>>(async () => []);
const markMirrored = vi.fn<(...a: unknown[]) => Promise<void>>(async () => {});
const markFailed = vi.fn<(...a: unknown[]) => Promise<void>>(async () => {});
vi.mock('./meta-post-media.service', () => ({
  recordPostMedia: (...a: unknown[]) => recordPostMedia(...a),
  claimPendingMedia: (...a: unknown[]) => claimPendingMedia(...a),
  markMirrored: (...a: unknown[]) => markMirrored(...a),
  markFailed: (...a: unknown[]) => markFailed(...a),
}));

const isStorageConfigured = vi.fn<() => boolean>(() => false);
vi.mock('$server/storage/blob', () => ({
  isStorageConfigured: () => isStorageConfigured(),
  getStorage: vi.fn(),
}));

const fetchImageSafely = vi.fn<(...a: unknown[]) => Promise<{ data: Uint8Array; contentType: string; fileName: string }>>();
vi.mock('../ssrf-guard', () => ({
  fetchImageSafely: (...a: unknown[]) => fetchImageSafely(...a),
}));

const uploadFile = vi.fn<(...a: unknown[]) => Promise<string>>();
vi.mock('../file.service', () => ({
  uploadFile: (...a: unknown[]) => uploadFile(...a),
}));

import {
  toMetaIngestRow,
  computeAdsSince,
  adInsightRowToInsert,
  metricInsightsToRows,
  fallbackEngagementRows,
  adTimeWindows,
  resolveSyncSince,
  fullAdsHistorySince,
  defaultSinceDate,
  FULL_HISTORY_SINCE,
  adStoryLinksToRows,
  runJob,
} from './meta-sync.service';

import { normalizeIgConvo } from './graph-read';

const PAGE_ID = 'page-1';
const CUSTOMER_ID = 'customer-1';
const participants = { data: [{ id: PAGE_ID, name: 'FACES' }, { id: CUSTOMER_ID, name: 'Customer' }] };

describe('toMetaIngestRow', () => {
  it('maps an inbound message: chatId/senderId = the customer, direction inbound', () => {
    const row = toMetaIngestRow({
      message: { id: 'm1', from: { id: CUSTOMER_ID, name: 'Customer' }, created_time: '2026-07-01T10:00:00+0000', message: 'hi' },
      participants,
      pageExternalId: PAGE_ID,
      channel: 'messenger',
    });
    expect(row).toMatchObject({
      direction: 'inbound',
      channel: 'messenger',
      accountId: PAGE_ID,
      chatId: CUSTOMER_ID,
      senderId: CUSTOMER_ID,
      messageId: 'm1',
      content: 'hi',
    });
    expect(row?.clientId).toBe('meta:messenger:m1');
    expect(row?.occurredAt).toBe(Date.parse('2026-07-01T10:00:00+0000'));
  });

  it('maps an outbound message: chatId stays the customer, senderId flips to the page', () => {
    const row = toMetaIngestRow({
      message: { id: 'm2', from: { id: PAGE_ID }, created_time: '2026-07-01T10:05:00+0000', message: 'thanks for reaching out' },
      participants,
      pageExternalId: PAGE_ID,
      channel: 'messenger',
    });
    expect(row).toMatchObject({ direction: 'outbound', chatId: CUSTOMER_ID, senderId: PAGE_ID, accountId: PAGE_ID });
  });

  it('inbound senderName resolves from the participants list', () => {
    const row = toMetaIngestRow({
      message: { id: 'm1n', from: { id: CUSTOMER_ID }, created_time: '2026-07-01T10:00:00+0000', message: 'hi' },
      participants,
      pageExternalId: PAGE_ID,
      channel: 'messenger',
      pageName: 'FACES Page',
    });
    expect(row?.senderName).toBe('Customer');
  });

  it('inbound senderName falls back to the per-message from.name when absent from participants', () => {
    const row = toMetaIngestRow({
      message: { id: 'm1f', from: { id: CUSTOMER_ID, name: 'From Name' } },
      participants: { data: [{ id: PAGE_ID, name: 'FACES' }, { id: CUSTOMER_ID }] },
      pageExternalId: PAGE_ID,
      channel: 'messenger',
    });
    expect(row?.senderName).toBe('From Name');
  });

  it('outbound senderName is the page name, not a participant lookup', () => {
    const row = toMetaIngestRow({
      message: { id: 'm2n', from: { id: PAGE_ID } },
      participants,
      pageExternalId: PAGE_ID,
      channel: 'messenger',
      pageName: 'FACES Page',
    });
    expect(row?.senderName).toBe('FACES Page');
  });

  it('senderName is null when neither a page name nor a participant name is available', () => {
    const row = toMetaIngestRow({
      message: { id: 'm2u', from: { id: PAGE_ID } },
      participants: { data: [{ id: PAGE_ID }, { id: CUSTOMER_ID }] },
      pageExternalId: PAGE_ID,
      channel: 'messenger',
    });
    expect(row?.senderName).toBeNull();
  });

  it('tags instagram channel through', () => {
    const row = toMetaIngestRow({
      message: { id: 'm3', from: { id: CUSTOMER_ID } },
      participants,
      pageExternalId: PAGE_ID,
      channel: 'instagram',
    });
    expect(row?.channel).toBe('instagram');
    expect(row?.clientId).toBe('meta:instagram:m3');
  });

  it('skips a message with no resolvable author', () => {
    const row = toMetaIngestRow({ message: { id: 'm4' }, participants, pageExternalId: PAGE_ID, channel: 'messenger' });
    expect(row).toBeNull();
  });

  it('skips when the customer side cannot be resolved (page-to-page, no other participant)', () => {
    const row = toMetaIngestRow({
      message: { id: 'm5', from: { id: PAGE_ID } },
      participants: { data: [{ id: PAGE_ID }] },
      pageExternalId: PAGE_ID,
      channel: 'messenger',
    });
    expect(row).toBeNull();
  });

  // IG-Login DMs: normalizeIgConvo maps username→name, and the account's self
  // id (the professional-account id from getIgLoginUser) drives direction —
  // NOT the asset external_id (the OAuth-flow id, which never appears in the
  // conversation). This is the id-mismatch that would misclassify every message.
  it('IG-Login DM: inbound handle + outbound account name resolve after normalizeIgConvo', () => {
    const SELF = '17841448369679209';
    const CUST = '1579908617077220';
    const convo = normalizeIgConvo({
      id: 'c1',
      participants: {
        data: [
          { id: SELF, username: 'facesculptors' },
          { id: CUST, username: 'tatiana.peralta15' },
        ],
      },
      messages: {
        data: [
          { id: 'g1', from: { id: CUST, username: 'tatiana.peralta15' }, message: 'Tengo dudas', created_time: '2026-07-17T02:36:42+0000' },
          { id: 'g2', from: { id: SELF, username: 'facesculptors' }, message: 'Hola', created_time: '2026-07-17T02:36:44+0000' },
        ],
      },
    });
    const inbound = toMetaIngestRow({ message: convo.messages!.data![0], participants: convo.participants, pageExternalId: SELF, channel: 'instagram', pageName: 'facesculptors' });
    expect(inbound).toMatchObject({ direction: 'inbound', channel: 'instagram', accountId: SELF, chatId: CUST, senderName: 'tatiana.peralta15', content: 'Tengo dudas', clientId: 'meta:instagram:g1' });
    const outbound = toMetaIngestRow({ message: convo.messages!.data![1], participants: convo.participants, pageExternalId: SELF, channel: 'instagram', pageName: 'facesculptors' });
    expect(outbound).toMatchObject({ direction: 'outbound', chatId: CUST, senderId: SELF, senderName: 'facesculptors' });
  });
});

describe('computeAdsSince — 2-day restatement window vs 90-day floor', () => {
  const now = new Date('2026-07-04T00:00:00Z');

  it('with no prior sync, floors at 90 days back', () => {
    expect(computeAdsSince(null, now)).toBe('2026-04-05');
  });

  it('rewinds 2 days from the last synced date when that stays inside the 90-day floor', () => {
    // last synced 2026-07-01 → since = 2026-06-29
    expect(computeAdsSince('2026-07-01', now)).toBe('2026-06-29');
  });

  it('clamps to the 90-day floor when the 2-day rewind would go further back', () => {
    // last synced 2026-04-06 (just 1 day inside the floor) → rewind would land
    // 2026-04-04, before the 2026-04-05 floor, so the floor wins.
    expect(computeAdsSince('2026-04-06', now)).toBe('2026-04-05');
  });
});

describe('adInsightRowToInsert', () => {
  it('maps a Graph ad-insight row to the meta_ad_insights insert shape', () => {
    const row = adInsightRowToInsert(
      {
        ad_id: 'ad-1',
        ad_name: 'Ad One',
        campaign_id: 'c-1',
        campaign_name: 'Campaign',
        adset_id: 'as-1',
        adset_name: 'Adset',
        spend: '12.50',
        impressions: '1000',
        reach: '800',
        clicks: '20',
        ctr: '2.0',
        cpc: '0.625',
        actions: [{ action_type: 'link_click', value: '5' }],
        date_start: '2026-07-01',
        date_stop: '2026-07-01',
      },
      { orgId: 'org-1', adAccountId: 'act_123', currency: 'PEN' },
    );
    expect(row).toMatchObject({
      orgId: 'org-1',
      adAccountId: 'act_123',
      adId: 'ad-1',
      date: '2026-07-01',
      spend: '12.50',
      impressions: 1000,
      reach: 800,
      clicks: 20,
      currency: 'PEN',
    });
  });

  it('returns null when the row is missing the unique-index columns (ad_id/date)', () => {
    expect(adInsightRowToInsert({ spend: '1' }, { orgId: 'org-1', adAccountId: 'act_1', currency: null })).toBeNull();
  });
});

describe('adStoryLinksToRows — meta_ad_posts row mapping', () => {
  it('emits one row per ad with a story id, defaulting platform to fb', () => {
    const rows = adStoryLinksToRows('org-1', [
      { adId: 'ad-1', storyId: 'page-1_100', igMediaId: null, thumbnailUrl: null },
      { adId: 'ad-2', storyId: 'page-1_200', igMediaId: null, thumbnailUrl: null },
    ]);
    expect(rows).toEqual([
      { orgId: 'org-1', adId: 'ad-1', postId: 'page-1_100', platform: 'fb' },
      { orgId: 'org-1', adId: 'ad-2', postId: 'page-1_200', platform: 'fb' },
    ]);
  });

  it('drops an ad with no story id (dark post / deleted creative) — no row, not a null postId', () => {
    const rows = adStoryLinksToRows('org-1', [
      { adId: 'ad-1', storyId: 'page-1_100', igMediaId: null, thumbnailUrl: null },
      { adId: 'ad-dark', storyId: null, igMediaId: null, thumbnailUrl: null },
    ]);
    expect(rows).toEqual([{ orgId: 'org-1', adId: 'ad-1', postId: 'page-1_100', platform: 'fb' }]);
  });

  it('returns an empty array for an empty input', () => {
    expect(adStoryLinksToRows('org-1', [])).toEqual([]);
  });
});

describe('metricInsightsToRows', () => {
  const meta = {
    orgId: 'org-1',
    assetId: 'asset-1',
    platform: 'fb' as const,
    postId: 'post-1',
    permalink: null,
    caption: null,
    mediaType: null,
    postedAt: null,
    isPromoted: false,
  };

  it('emits one row per numeric metric and degrades non-numeric ones', () => {
    const { rows, nonNumeric } = metricInsightsToRows(
      [
        { name: 'post_impressions', values: [{ value: 42 }] },
        { name: 'post_reactions_by_type_total', values: [{ value: { like: 3, love: 1 } }] }, // object value, not numeric
      ],
      meta,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ metric: 'post_impressions', value: '42' });
    expect(nonNumeric).toBe(1);
  });

  it('carries isPromoted:true through to every row when the post matched a story id', () => {
    const { rows } = metricInsightsToRows([{ name: 'post_impressions', values: [{ value: 10 }] }], {
      ...meta,
      isPromoted: true,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ isPromoted: true });
  });
});

describe('fallbackEngagementRows — engagement-count fallback (read_insights unavailable)', () => {
  const fbMeta = {
    orgId: 'org-1',
    assetId: 'asset-1',
    platform: 'fb' as const,
    permalink: null,
    caption: null,
    mediaType: null,
    postedAt: null,
    isPromoted: false,
  };

  it('emits reactions/comments/shares rows for an FB post even when a denied /insights call yields nothing', () => {
    const post = {
      id: 'post-1',
      reactions: { summary: { total_count: 5 } },
      comments: { summary: { total_count: 2 } },
      shares: { count: 1 },
    };
    const rows = fallbackEngagementRows(post, fbMeta);
    expect(rows).toHaveLength(3);
    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ metric: 'reactions_total', value: '5', postId: 'post-1', period: 'lifetime' }),
        expect.objectContaining({ metric: 'comments_total', value: '2', postId: 'post-1' }),
        expect.objectContaining({ metric: 'shares_total', value: '1', postId: 'post-1' }),
      ]),
    );
  });

  it('a bare FB post (no fetchable summaries) still anchors with shares_total=0 — never fabricates reactions/comments', () => {
    const rows = fallbackEngagementRows({ id: 'post-2' }, fbMeta);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ metric: 'shares_total', value: '0', postId: 'post-2' });
  });

  it('emits reactions_total/comments_total for IG media from like_count/comments_count (no shares_total)', () => {
    const rows = fallbackEngagementRows(
      { id: 'media-1', like_count: 9, comments_count: 4 },
      { ...fbMeta, platform: 'ig' },
    );
    expect(rows).toHaveLength(2);
    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ metric: 'reactions_total', value: '9', platform: 'ig' }),
        expect.objectContaining({ metric: 'comments_total', value: '4', platform: 'ig' }),
      ]),
    );
  });

  it('is_promoted mapping — hit vs miss against the story-id set (isPromoted flag flows straight through)', () => {
    const promoted = fallbackEngagementRows({ id: 'post-hit' }, { ...fbMeta, isPromoted: true });
    const organic = fallbackEngagementRows({ id: 'post-miss' }, { ...fbMeta, isPromoted: false });
    expect(promoted[0]).toMatchObject({ isPromoted: true });
    expect(organic[0]).toMatchObject({ isPromoted: false });
  });
});

describe('resolveSyncSince — full-history window per sync kind', () => {
  const now = new Date('2026-07-04T00:00:00Z');

  it('non-full: same 90-day default for every kind, unchanged from today', () => {
    expect(resolveSyncSince('posts', false, now)).toBe(defaultSinceDate(90, now));
    expect(resolveSyncSince('ads', false, now)).toBe(defaultSinceDate(90, now));
    expect(resolveSyncSince('messages', false, now)).toBe(defaultSinceDate(90, now));
  });

  it('full: posts/messages go all the way back to FULL_HISTORY_SINCE', () => {
    expect(resolveSyncSince('posts', true, now)).toBe(FULL_HISTORY_SINCE);
    expect(resolveSyncSince('messages', true, now)).toBe(FULL_HISTORY_SINCE);
  });

  it('full: ads clamps to the 36-month lookback window, not all the way to FULL_HISTORY_SINCE', () => {
    expect(resolveSyncSince('ads', true, now)).toBe(fullAdsHistorySince(now));
    expect(resolveSyncSince('ads', true, now)).not.toBe(FULL_HISTORY_SINCE);
    expect(resolveSyncSince('ads', true, now)).toBe('2023-07-04');
  });
});

describe('runJob(posts) — promoted-post labeling + insights-call skip-after-first-denial', () => {
  const connection = {
    id: 'conn-1',
    orgId: 'org-1',
    kind: 'system_user',
    fbUserId: 'fbu-1',
    tokenCiphertext: 'user-token',
    tokenIv: 'iv',
    tokenExpiresAt: null,
    grantedScopes: [],
    status: 'active',
    connectedBy: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  const pageAsset = {
    id: 'asset-page-1',
    orgId: 'org-1',
    connectionId: 'conn-1',
    kind: 'page',
    externalId: 'page-1',
    name: 'FACES Page',
    pageTokenCiphertext: 'page-token',
    pageTokenIv: 'iv',
    parentPageId: null,
    currency: null,
    enabled: true,
    meta: {},
    createdAt: new Date(),
  } as unknown as MetaAsset;
  const adAccountAsset = {
    id: 'asset-ad-1',
    orgId: 'org-1',
    connectionId: 'conn-1',
    kind: 'ad_account',
    externalId: 'act_1',
    name: 'FACES Ads',
    pageTokenCiphertext: null,
    pageTokenIv: null,
    parentPageId: null,
    currency: 'PEN',
    enabled: true,
    meta: {},
    createdAt: new Date(),
  } as unknown as MetaAsset;
  const job = {
    id: 'job-1',
    orgId: 'org-1',
    kind: 'posts',
    status: 'running',
    pageCursor: null,
    since: null,
    until: null,
    counts: {},
    error: null,
    startedAt: new Date(),
    finishedAt: null,
    createdAt: new Date(),
  } as unknown as MetaSyncJob;

  beforeEach(() => {
    vi.clearAllMocks();
    claimJob.mockResolvedValue(true);
    getJobById.mockResolvedValue(job);
    listConnections.mockResolvedValue([connection]);
    listAssets.mockResolvedValue([pageAsset, adAccountAsset]);
    listAdsWithStoryIds.mockResolvedValue({
      ok: true,
      status: 200,
      data: [
        { adId: 'ad-1', storyId: 'page-1_100' },
        { adId: 'ad-2', storyId: null }, // dark post / deleted creative — no meta_ad_posts row, no story id
      ],
    });
    listPagePosts.mockResolvedValue({
      ok: true,
      status: 200,
      data: [
        { id: 'page-1_100', permalink_url: 'https://fb/1', message: 'promoted', created_time: '2026-07-01T00:00:00+0000', shares: { count: 2 } },
        { id: 'page-1_200', permalink_url: 'https://fb/2', message: 'organic', created_time: '2026-07-01T00:00:00+0000', shares: { count: 1 } },
        { id: 'page-1_300', permalink_url: 'https://fb/3', message: 'organic 2', created_time: '2026-07-01T00:00:00+0000', shares: { count: 0 } },
      ],
    });
    postInsights.mockResolvedValue({ ok: false, status: 400, error: 'permission denied' });
  });

  it('calls postInsights only once (first denial), skipping the remaining posts in the slice', async () => {
    const { db } = createMockDb();
    const ctx = { db: db as never, tenantId: 'org-1' };

    await runJob(ctx, 'job-1');

    expect(listAdsWithStoryIds).toHaveBeenCalledWith('act_1', 'user-token', expect.anything());
    expect(postInsights).toHaveBeenCalledTimes(1);
    expect(recordProgress).toHaveBeenCalledWith(
      ctx,
      'job-1',
      expect.objectContaining({
        pageCursor: null,
        countsDelta: expect.objectContaining({ postsProcessed: 3, metricsDenied: 1, metricsSkipped: 2 }),
      }),
    );
    expect(finishJob).toHaveBeenCalledWith(ctx, 'job-1', 'succeeded');
  });

  it('persists the ad→post link (meta_ad_posts) — db.insert is invoked with the meta_ad_posts table', async () => {
    const { db } = createMockDb();
    const ctx = { db: db as never, tenantId: 'org-1' };

    await runJob(ctx, 'job-1');

    const insertCalls = (db.insert as unknown as { mock: { calls: unknown[][] } }).mock.calls;
    expect(insertCalls.some((c) => c[0] === metaAdPosts)).toBe(true);
  });

  it('never touches meta_ad_posts when no ad has a story id', async () => {
    listAdsWithStoryIds.mockResolvedValue({ ok: true, status: 200, data: [{ adId: 'ad-2', storyId: null }] });
    const { db } = createMockDb();
    const ctx = { db: db as never, tenantId: 'org-1' };

    await runJob(ctx, 'job-1');

    const insertCalls = (db.insert as unknown as { mock: { calls: unknown[][] } }).mock.calls;
    expect(insertCalls.some((c) => c[0] === metaAdPosts)).toBe(false);
  });

  it('a failed listAdsWithStoryIds fetch degrades exactly as before — no throw, isPromoted stays false, job still succeeds', async () => {
    listAdsWithStoryIds.mockResolvedValue({ ok: false, status: 500, error: 'graph request failed' });
    const { db } = createMockDb();
    const ctx = { db: db as never, tenantId: 'org-1' };

    await runJob(ctx, 'job-1');

    const insertCalls = (db.insert as unknown as { mock: { calls: unknown[][] } }).mock.calls;
    expect(insertCalls.some((c) => c[0] === metaAdPosts)).toBe(false);
    expect(recordProgress).toHaveBeenCalledWith(
      ctx,
      'job-1',
      expect.objectContaining({ countsDelta: expect.objectContaining({ adStoryFetchFailed: 1 }) }),
    );
    expect(finishJob).toHaveBeenCalledWith(ctx, 'job-1', 'succeeded');
  });

  it('records a pending meta_post_media row from the ad creative thumbnail for a dark post (storyId + thumbnailUrl both present)', async () => {
    listAdsWithStoryIds.mockResolvedValue({
      ok: true,
      status: 200,
      data: [{ adId: 'ad-dark', storyId: 'page-1_999', thumbnailUrl: 'https://cdn/dark.jpg' }],
    });
    const { db } = createMockDb();
    const ctx = { db: db as never, tenantId: 'org-1' };

    await runJob(ctx, 'job-1');

    expect(recordPostMedia).toHaveBeenCalledWith(ctx, {
      orgId: 'org-1',
      platform: 'fb',
      postId: 'page-1_999',
      sourceUrl: 'https://cdn/dark.jpg',
      mediaType: null,
    });
  });

  it('skips recording when storyId is null (no post to attach a preview to)', async () => {
    listAdsWithStoryIds.mockResolvedValue({
      ok: true,
      status: 200,
      data: [{ adId: 'ad-dark', storyId: null, thumbnailUrl: 'https://cdn/dark.jpg' }],
    });
    const { db } = createMockDb();
    const ctx = { db: db as never, tenantId: 'org-1' };

    await runJob(ctx, 'job-1');

    expect(recordPostMedia).not.toHaveBeenCalledWith(ctx, expect.objectContaining({ sourceUrl: 'https://cdn/dark.jpg' }));
  });

  it('skips recording when thumbnailUrl is null (nothing to mirror)', async () => {
    listAdsWithStoryIds.mockResolvedValue({
      ok: true,
      status: 200,
      data: [{ adId: 'ad-dark', storyId: 'page-1_999', thumbnailUrl: null }],
    });
    const { db } = createMockDb();
    const ctx = { db: db as never, tenantId: 'org-1' };

    await runJob(ctx, 'job-1');

    expect(recordPostMedia).not.toHaveBeenCalledWith(ctx, expect.objectContaining({ postId: 'page-1_999' }));
  });

  it('dedupes: two ads sharing one story id record that post exactly once', async () => {
    listAdsWithStoryIds.mockResolvedValue({
      ok: true,
      status: 200,
      data: [
        { adId: 'ad-dark-a', storyId: 'page-1_999', thumbnailUrl: 'https://cdn/dark-a.jpg' },
        { adId: 'ad-dark-b', storyId: 'page-1_999', thumbnailUrl: 'https://cdn/dark-b.jpg' },
      ],
    });
    const { db } = createMockDb();
    const ctx = { db: db as never, tenantId: 'org-1' };

    await runJob(ctx, 'job-1');

    const darkPostCalls = recordPostMedia.mock.calls.filter((c) => (c[1] as { postId?: string })?.postId === 'page-1_999');
    expect(darkPostCalls).toHaveLength(1);
  });
});

describe('runJob — connection-by-kind selection (spec 2026-07-05-instagram-login-integration §7)', () => {
  const flbConnection = {
    id: 'conn-1',
    orgId: 'org-1',
    kind: 'system_user',
    fbUserId: 'fbu-1',
    tokenCiphertext: 'user-token',
    tokenIv: 'iv',
    tokenExpiresAt: null,
    grantedScopes: [],
    status: 'active',
    connectedBy: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  const igConnection = {
    id: 'conn-ig',
    orgId: 'org-1',
    kind: 'ig_login',
    fbUserId: 'ig-user-1',
    tokenCiphertext: 'ig-token',
    tokenIv: 'iv',
    tokenExpiresAt: new Date(Date.now() + 30 * 86_400_000), // well inside the 60-day life, not "expiring"
    grantedScopes: ['instagram_business_basic'],
    status: 'active',
    connectedBy: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  const pageAsset = {
    id: 'asset-page-1',
    orgId: 'org-1',
    connectionId: 'conn-1',
    kind: 'page',
    externalId: 'page-1',
    name: 'FACES Page',
    pageTokenCiphertext: 'page-token',
    pageTokenIv: 'iv',
    parentPageId: null,
    currency: null,
    enabled: true,
    meta: {},
    createdAt: new Date(),
  } as unknown as MetaAsset;
  const adAccountAsset = {
    id: 'asset-ad-1',
    orgId: 'org-1',
    connectionId: 'conn-1',
    kind: 'ad_account',
    externalId: 'act_1',
    name: 'FACES Ads',
    pageTokenCiphertext: null,
    pageTokenIv: null,
    parentPageId: null,
    currency: 'PEN',
    enabled: true,
    meta: {},
    createdAt: new Date(),
  } as unknown as MetaAsset;
  // IG-Login asset: no parent page — the discriminator syncPosts uses to know
  // its token lives on the connection (conn-ig), not a parent page asset.
  const igLoginAsset = {
    id: 'asset-ig-login-1',
    orgId: 'org-1',
    connectionId: 'conn-ig',
    kind: 'ig',
    externalId: 'ig-user-1',
    name: 'faces.sculptors',
    pageTokenCiphertext: null,
    pageTokenIv: null,
    parentPageId: null,
    currency: null,
    enabled: true,
    meta: {},
    createdAt: new Date(),
  } as unknown as MetaAsset;

  beforeEach(() => {
    vi.clearAllMocks();
    claimJob.mockResolvedValue(true);
    listAdsWithStoryIds.mockResolvedValue({ ok: true, status: 200, data: [] });
  });

  it('ads job: picks the FLB connection token even when listConnections returns the IG-Login connection first', async () => {
    listConnections.mockResolvedValue([igConnection, flbConnection]); // IG-Login sorts first — "first wins" would pick the wrong one
    listAssets.mockResolvedValue([adAccountAsset]);
    getJobById.mockResolvedValue({
      id: 'job-ads',
      orgId: 'org-1',
      kind: 'ads',
      status: 'running',
      pageCursor: null,
      since: null,
      until: null,
      counts: {},
      error: null,
      startedAt: new Date(),
      finishedAt: null,
      createdAt: new Date(),
    } as unknown as MetaSyncJob);
    adInsightsMock.mockResolvedValue({ ok: true, status: 200, data: [] });

    const { db } = createMockDb();
    const ctx = { db: db as never, tenantId: 'org-1' };
    await runJob(ctx, 'job-ads');

    expect(adInsightsMock).toHaveBeenCalledWith('act_1', 'user-token', expect.anything(), expect.anything());
    expect(finishJob).toHaveBeenCalledWith(ctx, 'job-ads', 'succeeded');
  });

  it('posts job: reads the FLB page with its own page token AND the IG-Login asset with its connection token', async () => {
    listConnections.mockResolvedValue([flbConnection, igConnection]);
    listAssets.mockResolvedValue([pageAsset, igLoginAsset]);
    getJobById.mockResolvedValue({
      id: 'job-posts-both',
      orgId: 'org-1',
      kind: 'posts',
      status: 'running',
      pageCursor: null,
      since: null,
      until: null,
      counts: {},
      error: null,
      startedAt: new Date(),
      finishedAt: null,
      createdAt: new Date(),
    } as unknown as MetaSyncJob);
    listPagePosts.mockResolvedValue({ ok: true, status: 200, data: [] });
    listIgMedia.mockResolvedValue({
      ok: true,
      status: 200,
      data: [
        {
          id: 'ig-media-1',
          media_type: 'IMAGE',
          permalink: 'https://instagram.com/p/1',
          timestamp: '2026-07-01T00:00:00+0000',
          like_count: 9,
          comments_count: 4,
        },
      ],
    });

    const { db } = createMockDb();
    const ctx = { db: db as never, tenantId: 'org-1' };
    await runJob(ctx, 'job-posts-both');

    expect(listPagePosts).toHaveBeenCalledWith('page-1', 'page-token', expect.anything(), expect.anything());
    // IG-Login reads /me/media (the OAuth user id is not a valid media-node
    // path on graph.instagram.com) with NO `since` (unsupported there) —
    // live-verified 2026-07-05.
    expect(listIgMedia).toHaveBeenCalledWith(
      'me',
      'ig-token',
      {},
      expect.objectContaining({ baseUrl: 'https://graph.instagram.com', versioned: false }),
    );
    // IG-Login's instagram_business_basic scope never grants /insights — the
    // fallback engagement row (like_count/comments_count) is the only row this
    // branch produces, never a live metrics call.
    expect(igMediaInsights).not.toHaveBeenCalled();
    expect(finishJob).toHaveBeenCalledWith(ctx, 'job-posts-both', 'succeeded');
  });
});

describe('syncPosts — thumbnail mirror pass (spec 2026-07-05-meta-post-thumbnail-mirroring, WP3)', () => {
  const connection = {
    id: 'conn-1',
    orgId: 'org-1',
    kind: 'system_user',
    fbUserId: 'fbu-1',
    tokenCiphertext: 'user-token',
    tokenIv: 'iv',
    tokenExpiresAt: null,
    grantedScopes: [],
    status: 'active',
    connectedBy: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  const pageAsset = {
    id: 'asset-page-1',
    orgId: 'org-1',
    connectionId: 'conn-1',
    kind: 'page',
    externalId: 'page-1',
    name: 'FACES Page',
    pageTokenCiphertext: 'page-token',
    pageTokenIv: 'iv',
    parentPageId: null,
    currency: null,
    enabled: true,
    meta: {},
    createdAt: new Date(),
  } as unknown as MetaAsset;
  const job = {
    id: 'job-1',
    orgId: 'org-1',
    kind: 'posts',
    status: 'running',
    pageCursor: null,
    since: null,
    until: null,
    counts: {},
    error: null,
    startedAt: new Date(),
    finishedAt: null,
    createdAt: new Date(),
  } as unknown as MetaSyncJob;

  beforeEach(() => {
    vi.clearAllMocks();
    claimJob.mockResolvedValue(true);
    getJobById.mockResolvedValue(job);
    listConnections.mockResolvedValue([connection]);
    listAssets.mockResolvedValue([pageAsset]);
    listAdsWithStoryIds.mockResolvedValue({ ok: true, status: 200, data: [] });
    postInsights.mockResolvedValue({ ok: false, status: 400, error: 'permission denied' });
    recordPostMedia.mockResolvedValue(undefined);
    claimPendingMedia.mockResolvedValue([]);
    markMirrored.mockResolvedValue(undefined);
    markFailed.mockResolvedValue(undefined);
    isStorageConfigured.mockReturnValue(false);
  });

  function ctxWithMockDb() {
    const { db } = createMockDb();
    return { db: db as never, tenantId: 'org-1' };
  }

  it('records a pending row with the post preview url, and a skipped row for a text-only post', async () => {
    listPagePosts.mockResolvedValue({
      ok: true,
      status: 200,
      data: [
        {
          id: 'post-with-pic',
          permalink_url: 'https://fb/1',
          message: 'has image',
          created_time: '2026-07-01T00:00:00+0000',
          full_picture: 'https://cdn.example/pic.jpg',
        },
        {
          id: 'post-text-only',
          permalink_url: 'https://fb/2',
          message: 'no image',
          created_time: '2026-07-01T00:00:00+0000',
        },
      ],
    });

    const ctx = ctxWithMockDb();
    await runJob(ctx, 'job-1');

    expect(recordPostMedia).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({ postId: 'post-with-pic', sourceUrl: 'https://cdn.example/pic.jpg', platform: 'fb' }),
    );
    expect(recordPostMedia).toHaveBeenCalledWith(ctx, expect.objectContaining({ postId: 'post-text-only', sourceUrl: null }));
  });

  it('no-op mirror pass when storage is not configured — never claims, counts mediaSkipped, never fails the job', async () => {
    listPagePosts.mockResolvedValue({ ok: true, status: 200, data: [] });
    isStorageConfigured.mockReturnValue(false);

    const ctx = ctxWithMockDb();
    await runJob(ctx, 'job-1');

    expect(claimPendingMedia).not.toHaveBeenCalled();
    expect(recordProgress).toHaveBeenCalledWith(
      ctx,
      'job-1',
      expect.objectContaining({ countsDelta: expect.objectContaining({ mediaSkipped: 1 }) }),
    );
    expect(finishJob).toHaveBeenCalledWith(ctx, 'job-1', 'succeeded');
  });

  it('mirrors up to the cap (10), marks per-row success/failure, and never fails the posts job over a mirror error', async () => {
    listPagePosts.mockResolvedValue({ ok: true, status: 200, data: [] });
    isStorageConfigured.mockReturnValue(true);
    claimPendingMedia.mockResolvedValue([
      {
        orgId: 'org-1',
        platform: 'fb',
        postId: 'post-ok',
        fileId: null,
        sourceUrl: 'https://cdn.example/ok.jpg',
        mediaType: null,
        status: 'pending',
        error: null,
        attempts: 0,
        fetchedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        orgId: 'org-1',
        platform: 'fb',
        postId: 'post-bad',
        fileId: null,
        sourceUrl: 'https://cdn.example/bad.jpg',
        mediaType: null,
        status: 'pending',
        error: null,
        attempts: 0,
        fetchedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);
    fetchImageSafely.mockImplementation(async (...args: unknown[]) => {
      const url = args[0] as string;
      if (url.includes('bad')) throw new Error('upstream 403');
      return { data: new Uint8Array([1, 2, 3]), contentType: 'image/jpeg', fileName: 'post-ok.jpg' };
    });
    uploadFile.mockResolvedValue('file-xyz');

    const ctx = ctxWithMockDb();
    await runJob(ctx, 'job-1');

    expect(claimPendingMedia).toHaveBeenCalledWith(ctx, 'org-1', 10);
    expect(uploadFile).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({
        fileName: 'post-ok.jpg',
        contentType: 'image/jpeg',
        category: 'meta/fb',
        cacheControl: expect.stringContaining('immutable'),
      }),
    );
    expect(markMirrored).toHaveBeenCalledWith(ctx, 'org-1', 'fb', 'post-ok', 'file-xyz');
    expect(markFailed).toHaveBeenCalledWith(ctx, 'org-1', 'fb', 'post-bad', expect.any(Error));
    // The bad row's failure must not propagate — the job still succeeds.
    expect(finishJob).toHaveBeenCalledWith(ctx, 'job-1', 'succeeded');
  });

  it('a mirror pass that throws outright (e.g. claim itself fails) never fails the posts job', async () => {
    listPagePosts.mockResolvedValue({ ok: true, status: 200, data: [] });
    isStorageConfigured.mockReturnValue(true);
    claimPendingMedia.mockRejectedValue(new Error('db unavailable'));

    const ctx = ctxWithMockDb();
    await runJob(ctx, 'job-1');

    expect(finishJob).toHaveBeenCalledWith(ctx, 'job-1', 'succeeded');
  });
});

describe('adTimeWindows — chunked ad-insights ranges', () => {
  it('splits a multi-year range into consecutive \u226490-day windows with no gaps or overlap', () => {
    const w = adTimeWindows('2023-07-05', '2026-07-05');
    expect(w.length).toBeGreaterThan(10);
    expect(w[0].since).toBe('2023-07-05');
    expect(w[w.length - 1].until).toBe('2026-07-05');
    for (let i = 1; i < w.length; i++) {
      const prevEnd = Date.parse(`${w[i - 1].until}T00:00:00Z`);
      const nextStart = Date.parse(`${w[i].since}T00:00:00Z`);
      expect(nextStart - prevEnd).toBe(86_400_000);
      const span = (Date.parse(`${w[i].until}T00:00:00Z`) - nextStart) / 86_400_000 + 1;
      expect(span).toBeLessThanOrEqual(90);
    }
  });

  it('a short incremental range stays a single window', () => {
    expect(adTimeWindows('2026-06-01', '2026-07-05')).toEqual([{ since: '2026-06-01', until: '2026-07-05' }]);
  });

  it('degrades to the raw pair on unparseable/inverted input', () => {
    expect(adTimeWindows('bogus', '2026-07-05')).toEqual([{ since: 'bogus', until: '2026-07-05' }]);
  });
});
