import { pgTable, uuid, text, jsonb, numeric, timestamp, boolean, integer, date, index, uniqueIndex, primaryKey } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

/**
 * Meta (Facebook/Instagram) Business integration — connections, org↔asset
 * bridge, and pulled insight/ad facts. Tenancy: `org_id text`, enforced by
 * withOrgCore (role app_ledger + app.current_org_id GUC). Policies/grants in
 * the companion migration <stamp>_meta.sql. Tokens are encrypted at rest
 * (ciphertext+iv columns, like finance creds). See
 * specs/2026-07-04-meta-business-integration.md §3 (frozen contract).
 */
export const metaConnections = pgTable(
  'meta_connections',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: text('org_id').notNull(),
    kind: text('kind').notNull(),                   // 'flb'|'system_user'
    fbUserId: text('fb_user_id'),
    tokenCiphertext: text('token_ciphertext'),
    tokenIv: text('token_iv'),
    tokenExpiresAt: timestamp('token_expires_at', { withTimezone: true }),
    grantedScopes: jsonb('granted_scopes').notNull().default([]),
    status: text('status').notNull().default('active'), // 'active'|'expiring'|'expired'|'revoked'
    connectedBy: text('connected_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniq: uniqueIndex('meta_connections_org_kind_fbuser_uniq').on(t.orgId, t.kind, t.fbUserId),
  }),
);

export const metaAssets = pgTable(
  'meta_assets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: text('org_id').notNull(),
    connectionId: uuid('connection_id').notNull().references(() => metaConnections.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),                    // 'page'|'ig'|'ad_account'
    externalId: text('external_id').notNull(),
    name: text('name'),
    pageTokenCiphertext: text('page_token_ciphertext'),
    pageTokenIv: text('page_token_iv'),
    parentPageId: text('parent_page_id'),            // for ig assets
    currency: text('currency'),                       // for ad_account assets
    enabled: boolean('enabled').notNull().default(true),
    meta: jsonb('meta').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniq: uniqueIndex('meta_assets_org_kind_ext_uniq').on(t.orgId, t.kind, t.externalId),
    connectionIdx: index('meta_assets_connection_idx').on(t.connectionId),
  }),
);

export const metaPostInsights = pgTable(
  'meta_post_insights',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: text('org_id').notNull(),
    assetId: uuid('asset_id').notNull().references(() => metaAssets.id, { onDelete: 'cascade' }),
    platform: text('platform').notNull(),            // 'fb'|'ig'
    postId: text('post_id').notNull(),
    permalink: text('permalink'),
    caption: text('caption'),
    mediaType: text('media_type'),
    postedAt: timestamp('posted_at', { withTimezone: true }),
    metric: text('metric').notNull(),
    value: numeric('value'),
    period: text('period').notNull().default('lifetime'),
    /** True when this post_id also appears as an ad creative's effective_object_story_id
     *  (i.e. it was boosted/run as an ad) — see meta-sync.service.ts collectPromotedStoryIds. */
    isPromoted: boolean('is_promoted').notNull().default(false),
    fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniq: uniqueIndex('meta_post_insights_org_post_metric_period_uniq').on(t.orgId, t.postId, t.metric, t.period),
    assetIdx: index('meta_post_insights_asset_idx').on(t.assetId),
  }),
);

export const metaAdInsights = pgTable(
  'meta_ad_insights',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: text('org_id').notNull(),
    adAccountId: text('ad_account_id').notNull(),
    campaignId: text('campaign_id'),
    campaignName: text('campaign_name'),
    adsetId: text('adset_id'),
    adsetName: text('adset_name'),
    adId: text('ad_id').notNull(),
    adName: text('ad_name'),
    date: date('date').notNull(),
    spend: numeric('spend'),
    impressions: integer('impressions'),
    reach: integer('reach'),
    clicks: integer('clicks'),
    ctr: numeric('ctr'),
    cpc: numeric('cpc'),
    actions: jsonb('actions').notNull().default([]),
    currency: text('currency'),
    fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniq: uniqueIndex('meta_ad_insights_org_ad_date_uniq').on(t.orgId, t.adId, t.date),
    accountIdx: index('meta_ad_insights_org_account_date_idx').on(t.orgId, t.adAccountId, t.date),
  }),
);

/** Durable, resumable background sync job — clone of fin_sync_jobs. */
export const metaSyncJobs = pgTable(
  'meta_sync_jobs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: text('org_id').notNull(),
    kind: text('kind').notNull(),                    // 'posts'|'ads'|'messages'
    status: text('status').notNull().default('queued'), // queued|running|succeeded|failed|cancelled
    pageCursor: text('page_cursor'),
    since: date('since'),
    until: date('until'),
    counts: jsonb('counts').notNull().default({}),
    error: text('error'),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    activeUq: uniqueIndex('meta_sync_jobs_active_uq')
      .on(t.orgId, t.kind)
      .where(sql`status in ('queued','running')`),
    latestIdx: index('meta_sync_jobs_org_kind_created_idx').on(t.orgId, t.kind, t.createdAt),
  }),
);

/**
 * One row per post — mirrors the Meta CDN thumbnail into our own bucket
 * (`file.service.uploadFile` category `meta/<platform>`). Distinct from
 * `meta_post_insights` (long/narrow, one row per post×metric×period): a
 * thumbnail belongs to the post, not a metric. See
 * specs/2026-07-05-meta-post-thumbnail-mirroring.md §4.
 */
export const metaPostMedia = pgTable(
  'meta_post_media',
  {
    orgId: text('org_id').notNull(),
    platform: text('platform').notNull(),            // 'fb'|'ig'
    postId: text('post_id').notNull(),
    fileId: text('file_id'),                          // → files.id (null until mirrored)
    sourceUrl: text('source_url'),                     // last CDN url mirrored from (audit/debug — expires, never re-served)
    mediaType: text('media_type'),                      // IMAGE|VIDEO|CAROUSEL_ALBUM|REELS (IG) / FB type
    status: text('status').notNull().default('pending'), // pending|mirrored|failed|skipped
    error: text('error'),
    attempts: integer('attempts').notNull().default(0),
    fetchedAt: timestamp('fetched_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.orgId, t.platform, t.postId] }),
    statusIdx: index('meta_post_media_org_status_idx').on(t.orgId, t.status),
  }),
);

/**
 * One row per (org, ad) — persists which organic post an ad is running as,
 * discovered from the ad creative's `effective_object_story_id` (spec
 * 2026-07-05-socials-rename-detail-pages.md §3). Distinct from
 * `meta_ad_insights` (one row per ad×date) — the link is per-ad, not per-day.
 */
export const metaAdPosts = pgTable(
  'meta_ad_posts',
  {
    orgId: text('org_id').notNull(),
    adId: text('ad_id').notNull(),
    postId: text('post_id').notNull(),
    platform: text('platform').notNull().default('fb'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.orgId, t.adId] }),
  }),
);

export type MetaConnection = typeof metaConnections.$inferSelect;
export type MetaAsset = typeof metaAssets.$inferSelect;
export type MetaPostInsight = typeof metaPostInsights.$inferSelect;
export type MetaAdInsight = typeof metaAdInsights.$inferSelect;
export type MetaSyncJob = typeof metaSyncJobs.$inferSelect;
export type MetaPostMedia = typeof metaPostMedia.$inferSelect;
export type MetaAdPost = typeof metaAdPosts.$inferSelect;
