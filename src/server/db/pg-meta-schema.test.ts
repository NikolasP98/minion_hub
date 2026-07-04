import { describe, it, expect } from 'vitest';
import { getTableColumns } from 'drizzle-orm';
import { metaConnections, metaAssets, metaPostInsights, metaAdInsights, metaSyncJobs } from './pg-meta-schema';

describe('pg-meta-schema', () => {
  it('meta_connections has the token + status columns', () => {
    const cols = Object.keys(getTableColumns(metaConnections));
    for (const c of ['id', 'orgId', 'kind', 'fbUserId', 'tokenCiphertext', 'tokenIv',
      'tokenExpiresAt', 'grantedScopes', 'status', 'connectedBy', 'createdAt', 'updatedAt']) {
      expect(cols).toContain(c);
    }
  });

  it('meta_assets bridges org to connection + carries per-asset tokens', () => {
    const cols = Object.keys(getTableColumns(metaAssets));
    for (const c of ['id', 'orgId', 'connectionId', 'kind', 'externalId', 'name',
      'pageTokenCiphertext', 'pageTokenIv', 'parentPageId', 'currency', 'enabled', 'meta', 'createdAt']) {
      expect(cols).toContain(c);
    }
  });

  it('meta_post_insights has the metric fact columns', () => {
    const cols = Object.keys(getTableColumns(metaPostInsights));
    for (const c of ['id', 'orgId', 'assetId', 'platform', 'postId', 'permalink', 'caption',
      'mediaType', 'postedAt', 'metric', 'value', 'period', 'fetchedAt']) {
      expect(cols).toContain(c);
    }
  });

  it('meta_ad_insights has the daily ad-level fact columns', () => {
    const cols = Object.keys(getTableColumns(metaAdInsights));
    for (const c of ['id', 'orgId', 'adAccountId', 'campaignId', 'campaignName', 'adsetId',
      'adsetName', 'adId', 'adName', 'date', 'spend', 'impressions', 'reach', 'clicks',
      'ctr', 'cpc', 'actions', 'currency', 'fetchedAt']) {
      expect(cols).toContain(c);
    }
  });

  it('meta_sync_jobs has the durable job columns', () => {
    const cols = Object.keys(getTableColumns(metaSyncJobs));
    for (const c of ['id', 'orgId', 'kind', 'status', 'pageCursor', 'since', 'until',
      'counts', 'error', 'startedAt', 'finishedAt', 'createdAt']) {
      expect(cols).toContain(c);
    }
  });
});
