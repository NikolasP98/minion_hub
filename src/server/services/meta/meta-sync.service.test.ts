import { describe, it, expect } from 'vitest';
import { toMetaIngestRow, computeAdsSince, adInsightRowToInsert, metricInsightsToRows } from './meta-sync.service';

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
});
