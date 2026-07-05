// src/server/services/meta/meta-insights.service.ts
//
// Org-scoped READ services for the Ads module (WP6). No writes here — OAuth,
// asset toggles, and sync triggers live in the WP4/WP5 API routes. Every query
// runs through withOrgCore (RLS-enforced) and aggregates in SQL rather than
// looping over raw rows in JS. See specs/2026-07-04-meta-business-integration.md
// §3 (schema) and §7 (this module's contract).
import { eq, desc, sql } from 'drizzle-orm';
import { withOrgCore } from '$server/db/with-org-core';
import type { CoreCtx } from '$server/auth/core-ctx';
import { metaConnections, metaAssets, metaSyncJobs } from '$server/db/pg-meta-schema';

export interface DateRange {
  /** Inclusive lower bound, 'YYYY-MM-DD'. */
  from: string;
  /** Exclusive upper bound, 'YYYY-MM-DD'. */
  to: string;
}

// ── Pure helpers (period math) — unit-tested in meta-insights.service.test.ts ──

/** Same-length window immediately preceding `range`, for period-over-period deltas. */
export function previousRange(range: DateRange): DateRange {
  const from = new Date(`${range.from}T00:00:00Z`).getTime();
  const to = new Date(`${range.to}T00:00:00Z`).getTime();
  const days = Math.max(1, Math.round((to - from) / 86_400_000));
  const prevTo = range.from;
  const prevFrom = new Date(from - days * 86_400_000).toISOString().slice(0, 10);
  return { from: prevFrom, to: prevTo };
}

/** Percent change, current vs previous. Null when there's no previous baseline
 *  to compare against (avoids a misleading "+∞%"). */
export function deltaPct(curr: number, prev: number): number | null {
  if (prev === 0) return curr === 0 ? 0 : null;
  return ((curr - prev) / prev) * 100;
}

export function calcCtr(clicks: number, impressions: number): number {
  return impressions > 0 ? (clicks / impressions) * 100 : 0;
}

export function calcCpc(spend: number, clicks: number): number {
  return clicks > 0 ? spend / clicks : 0;
}

// ── Data extent (campaigns/dashboard "default to full history" logic) ──────

export interface DataExtent {
  minDate: string | null;
  maxDate: string | null;
}

/** Org's ad-spend date range (min/max `date` in meta_ad_insights). Null bounds
 *  when the org has no ad rows yet (nothing synced). */
export function adDataExtent(ctx: CoreCtx): Promise<DataExtent> {
  return withOrgCore(ctx, async (tx) => {
    const [row] = (await tx.execute(sql`
      select min(date)::text as min_date, max(date)::text as max_date
      from meta_ad_insights
      where org_id = ${ctx.tenantId}
    `)) as unknown as Array<{ min_date: string | null; max_date: string | null }>;
    return { minDate: row?.min_date ?? null, maxDate: row?.max_date ?? null };
  });
}

/** Full-history DateRange from an extent (`to` exclusive, so maxDate+1 day).
 *  Falls back to the last `fallbackDays` ending today when there's no data yet
 *  (fresh/unsynced org) — same shape as the old hardcoded "last 30d" default. */
export function extentToRange(extent: DataExtent, now: Date = new Date(), fallbackDays = 30): DateRange {
  if (!extent.minDate || !extent.maxDate) {
    const to = now.toISOString().slice(0, 10);
    const from = new Date(now);
    from.setUTCDate(from.getUTCDate() - fallbackDays);
    return { from: from.toISOString().slice(0, 10), to };
  }
  const toDate = new Date(`${extent.maxDate}T00:00:00Z`);
  toDate.setUTCDate(toDate.getUTCDate() + 1);
  return { from: extent.minDate, to: toDate.toISOString().slice(0, 10) };
}

// ── Ad KPIs (dashboard ribbon) ──────────────────────────────────────────────

export interface AdKpiTotals {
  spend: number;
  impressions: number;
  reach: number;
  clicks: number;
  ctr: number;
  cpc: number;
}
export interface AdKpis extends AdKpiTotals {
  previous: AdKpiTotals;
  deltaPct: Record<'spend' | 'impressions' | 'reach' | 'clicks' | 'ctr' | 'cpc', number | null>;
}

async function kpiAgg(tx: Parameters<Parameters<CoreCtx['db']['transaction']>[0]>[0], orgId: string, r: DateRange): Promise<AdKpiTotals> {
  const [row] = (await tx.execute(sql`
    select coalesce(sum(spend), 0)::float8 spend,
           coalesce(sum(impressions), 0)::bigint impressions,
           coalesce(sum(reach), 0)::bigint reach,
           coalesce(sum(clicks), 0)::bigint clicks
    from meta_ad_insights
    where org_id = ${orgId} and date >= ${r.from} and date < ${r.to}
  `)) as unknown as Array<{ spend: number; impressions: number; reach: number; clicks: number }>;
  const spend = Number(row?.spend ?? 0);
  const impressions = Number(row?.impressions ?? 0);
  const reach = Number(row?.reach ?? 0); // ponytail: summed across ad×day rows, not deduped unique reach
  const clicks = Number(row?.clicks ?? 0);
  return { spend, impressions, reach, clicks, ctr: calcCtr(clicks, impressions), cpc: calcCpc(spend, clicks) };
}

/** KPI ribbon: spend/impressions/reach/clicks/ctr/cpc for `range`, plus the same
 *  totals for the immediately-preceding equal-length window and the % deltas. */
export function adKpis(ctx: CoreCtx, range: DateRange): Promise<AdKpis> {
  return withOrgCore(ctx, async (tx) => {
    const [curr, prev] = await Promise.all([
      kpiAgg(tx, ctx.tenantId, range),
      kpiAgg(tx, ctx.tenantId, previousRange(range)),
    ]);
    return {
      ...curr,
      previous: prev,
      deltaPct: {
        spend: deltaPct(curr.spend, prev.spend),
        impressions: deltaPct(curr.impressions, prev.impressions),
        reach: deltaPct(curr.reach, prev.reach),
        clicks: deltaPct(curr.clicks, prev.clicks),
        ctr: deltaPct(curr.ctr, prev.ctr),
        cpc: deltaPct(curr.cpc, prev.cpc),
      },
    };
  });
}

// ── Daily spend series (dashboard line chart) ───────────────────────────────

export interface AdSpendPoint {
  date: string;
  spend: number;
  impressions: number;
  clicks: number;
}

export function adSpendSeries(ctx: CoreCtx, range: DateRange): Promise<AdSpendPoint[]> {
  return withOrgCore(ctx, async (tx) => {
    const rows = (await tx.execute(sql`
      select date::text as date,
             coalesce(sum(spend), 0)::float8 spend,
             coalesce(sum(impressions), 0)::bigint impressions,
             coalesce(sum(clicks), 0)::bigint clicks
      from meta_ad_insights
      where org_id = ${ctx.tenantId} and date >= ${range.from} and date < ${range.to}
      group by date
      order by date
    `)) as unknown as Array<{ date: string; spend: number; impressions: number; clicks: number }>;
    return rows.map((r) => ({ date: r.date, spend: Number(r.spend), impressions: Number(r.impressions), clicks: Number(r.clicks) }));
  });
}

// ── Campaign → adset → ad breakdown (campaigns table) ───────────────────────

export type CampaignLevel = 'campaign' | 'adset' | 'ad';

export interface CampaignRow {
  campaignId: string | null;
  campaignName: string | null;
  adsetId: string | null;
  adsetName: string | null;
  adId: string | null;
  adName: string | null;
  spend: number;
  impressions: number;
  reach: number;
  clicks: number;
  ctr: number;
  cpc: number;
  /** Linked organic post id (ad level only — via meta_ad_posts). Null at
   *  campaign/adset level, or when the ad has no linked post (dark post). */
  postId: string | null;
  /** Mirrored thumbnail `files.id` for the linked post (ad level only). */
  thumbFileId: string | null;
}

/** Grouped campaign/adset/ad spend+performance for `range`. Aggregation runs in
 *  Postgres (group by the requested level) — the client only sorts/filters the
 *  already-small grouped result, never raw daily rows. Ad level additionally
 *  joins meta_ad_posts → meta_post_media so each ad row carries its linked
 *  post id + mirrored thumbnail (spec 2026-07-05 §4). */
export function campaignBreakdown(ctx: CoreCtx, range: DateRange, level: CampaignLevel = 'ad'): Promise<CampaignRow[]> {
  // Fixed 3-way enum, not user SQL — safe to splice as raw fragments.
  const selectAdset = level === 'campaign' ? sql`null::text as adset_id, null::text as adset_name,` : sql`mai.adset_id, max(mai.adset_name) as adset_name,`;
  const selectAd = level === 'ad' ? sql`mai.ad_id, max(mai.ad_name) as ad_name,` : sql`null::text as ad_id, null::text as ad_name,`;
  const groupBy =
    level === 'campaign' ? sql`mai.campaign_id` : level === 'adset' ? sql`mai.campaign_id, mai.adset_id` : sql`mai.campaign_id, mai.adset_id, mai.ad_id`;
  // Ad-level only: the post/thumbnail join keys (org_id, ad_id) / (org_id,
  // platform, post_id) are functionally dependent on the ad_id group — safe
  // to max() like postPerformance does for its media join.
  const postJoin =
    level === 'ad'
      ? sql`
          left join meta_ad_posts map on map.org_id = mai.org_id and map.ad_id = mai.ad_id
          left join meta_post_media mm on mm.org_id = map.org_id and mm.platform = map.platform and mm.post_id = map.post_id
        `
      : sql``;
  const selectPost = level === 'ad' ? sql`, max(map.post_id) as post_id, max(mm.file_id) filter (where mm.status = 'mirrored') as thumb_file_id` : sql``;
  return withOrgCore(ctx, async (tx) => {
    const rows = (await tx.execute(sql`
      select mai.campaign_id, max(mai.campaign_name) as campaign_name,
             ${selectAdset}
             ${selectAd}
             coalesce(sum(mai.spend), 0)::float8 spend,
             coalesce(sum(mai.impressions), 0)::bigint impressions,
             coalesce(sum(mai.reach), 0)::bigint reach,
             coalesce(sum(mai.clicks), 0)::bigint clicks
             ${selectPost}
      from meta_ad_insights mai
      ${postJoin}
      where mai.org_id = ${ctx.tenantId} and mai.date >= ${range.from} and mai.date < ${range.to}
      group by ${groupBy}
      order by spend desc
      limit 500
    `)) as unknown as Array<Record<string, unknown>>;
    return rows.map((r) => {
      const spend = Number(r.spend ?? 0);
      const impressions = Number(r.impressions ?? 0);
      const clicks = Number(r.clicks ?? 0);
      return {
        campaignId: r.campaign_id != null ? String(r.campaign_id) : null,
        campaignName: r.campaign_name != null ? String(r.campaign_name) : null,
        adsetId: r.adset_id != null ? String(r.adset_id) : null,
        adsetName: r.adset_name != null ? String(r.adset_name) : null,
        adId: r.ad_id != null ? String(r.ad_id) : null,
        adName: r.ad_name != null ? String(r.ad_name) : null,
        spend,
        impressions,
        reach: Number(r.reach ?? 0),
        clicks,
        ctr: calcCtr(clicks, impressions),
        cpc: calcCpc(spend, clicks),
        postId: r.post_id != null ? String(r.post_id) : null,
        thumbFileId: r.thumb_file_id != null ? String(r.thumb_file_id) : null,
      };
    });
  });
}

// ── Post performance (posts page + dashboard top posts) ─────────────────────

export interface PostRow {
  postId: string;
  platform: string | null;
  permalink: string | null;
  caption: string | null;
  postedAt: string | null;
  mediaType: string | null;
  /** Denormalized from meta_post_insights.is_promoted — true when the post is
   *  (also) a paid ad, not organic-only. Read via raw sql (not the drizzle
   *  query builder) so this works whether or not the column has landed in
   *  pg-meta-schema.ts yet — the column itself is already live in prod. */
  isPromoted: boolean;
  /** Whatever metrics landed for this post — column set is driven by whatever
   *  the sync pulled (IG metric names drift; see spec §10 risk #1), not a
   *  hardcoded list. UI renders whichever keys are present. */
  metrics: Record<string, number>;
  /** `files.id` of the mirrored thumbnail blob (spec 2026-07-05 §7), or null
   *  when not yet mirrored (pending/failed/skipped) — UI falls back to a
   *  platform-glyph placeholder in that case. */
  thumbFileId: string | null;
}

/**
 * Post/media performance, pivoted from the metric-per-row `meta_post_insights`
 * facts into one row per post with a `metrics` map (jsonb_object_agg — done in
 * SQL, not a JS reduce over raw rows). Filters to `period='lifetime'` so a
 * metric can't appear twice under different periods within one pivot.
 */
export function postPerformance(
  ctx: CoreCtx,
  opts: { limit?: number; orderBy?: 'recent' | 'score'; platform?: 'fb' | 'ig'; promoted?: boolean } = {},
): Promise<PostRow[]> {
  const limit = Math.min(opts.limit ?? 200, 500);
  const platformCond = opts.platform ? sql` and mi.platform = ${opts.platform}` : sql``;
  const promotedCond = opts.promoted === undefined ? sql`` : sql` and mi.is_promoted = ${opts.promoted}`;
  const orderClause = opts.orderBy === 'recent' ? sql`posted_at desc nulls last` : sql`score desc nulls last`;
  return withOrgCore(ctx, async (tx) => {
    const rows = (await tx.execute(sql`
      select mi.post_id,
             max(mi.platform) as platform,
             max(mi.permalink) as permalink,
             max(mi.caption) as caption,
             max(mi.posted_at)::text as posted_at,
             max(mi.media_type) as media_type,
             bool_or(mi.is_promoted) as is_promoted,
             jsonb_object_agg(mi.metric, mi.value) as metrics,
             sum(mi.value)::float8 as score,
             max(mm.file_id) filter (where mm.status = 'mirrored') as thumb_file_id
      from meta_post_insights mi
      left join meta_post_media mm
        on mm.org_id = mi.org_id and mm.platform = mi.platform and mm.post_id = mi.post_id
      where mi.org_id = ${ctx.tenantId} and mi.period = 'lifetime'${platformCond}${promotedCond}
      group by mi.post_id
      order by ${orderClause}
      limit ${limit}
    `)) as unknown as Array<Record<string, unknown>>;
    return rows.map((r) => ({
      postId: String(r.post_id),
      platform: r.platform != null ? String(r.platform) : null,
      permalink: r.permalink != null ? String(r.permalink) : null,
      caption: r.caption != null ? String(r.caption) : null,
      postedAt: r.posted_at != null ? String(r.posted_at) : null,
      mediaType: r.media_type != null ? String(r.media_type) : null,
      isPromoted: Boolean(r.is_promoted),
      metrics: Object.fromEntries(
        Object.entries((r.metrics as Record<string, unknown>) ?? {}).map(([k, v]) => [k, Number(v)]),
      ),
      thumbFileId: r.thumb_file_id != null ? String(r.thumb_file_id) : null,
    }));
  });
}

// ── Post detail (posts/[postId] page, spec 2026-07-05 §5.1) ─────────────────

export interface PostDetail {
  postId: string;
  platform: string | null;
  permalink: string | null;
  /** Full caption — no truncation (spec finding: not clipped at ingest, only
   *  by the table's CSS line-clamp; this is the "full text" surface). */
  caption: string | null;
  mediaType: string | null;
  postedAt: string | null;
  isPromoted: boolean;
  /** Every metric row for the post, not just the table's 3-column subset. */
  metrics: Record<string, number>;
  thumbFileId: string | null;
  thumbStatus: string | null;
  /** Reverse lookup on meta_ad_posts (post_id → ad ids) — populated only when isPromoted. */
  promotedByAdIds: string[];
}

/**
 * One post's full detail: every metric pivoted (not the table's 3-column
 * subset), full caption, mirrored-thumbnail status, and the ad ids (if any)
 * running this post as a promoted ad (spec §5.1's "Promoted by N ads" chip).
 * Null when the post doesn't exist (or belongs to another org) — the route
 * turns that into a 404, never a 403 (no existence leak).
 */
export function getPostDetail(ctx: CoreCtx, postId: string): Promise<PostDetail | null> {
  return withOrgCore(ctx, async (tx) => {
    const rows = (await tx.execute(sql`
      select mi.post_id,
             max(mi.platform) as platform,
             max(mi.permalink) as permalink,
             max(mi.caption) as caption,
             max(mi.posted_at)::text as posted_at,
             max(mi.media_type) as media_type,
             bool_or(mi.is_promoted) as is_promoted,
             jsonb_object_agg(mi.metric, mi.value) as metrics,
             max(mm.file_id) filter (where mm.status = 'mirrored') as thumb_file_id,
             max(mm.status) as thumb_status,
             (
               select string_agg(ap.ad_id, ',' order by ap.ad_id)
               from meta_ad_posts ap
               where ap.org_id = mi.org_id and ap.post_id = mi.post_id
             ) as promoted_by_ad_ids
      from meta_post_insights mi
      left join meta_post_media mm
        on mm.org_id = mi.org_id and mm.platform = mi.platform and mm.post_id = mi.post_id
      where mi.org_id = ${ctx.tenantId} and mi.post_id = ${postId} and mi.period = 'lifetime'
      group by mi.org_id, mi.post_id
    `)) as unknown as Array<Record<string, unknown>>;
    const r = rows[0];
    if (!r) return null;
    return {
      postId: String(r.post_id),
      platform: r.platform != null ? String(r.platform) : null,
      permalink: r.permalink != null ? String(r.permalink) : null,
      caption: r.caption != null ? String(r.caption) : null,
      mediaType: r.media_type != null ? String(r.media_type) : null,
      postedAt: r.posted_at != null ? String(r.posted_at) : null,
      isPromoted: Boolean(r.is_promoted),
      metrics: Object.fromEntries(
        Object.entries((r.metrics as Record<string, unknown>) ?? {}).map(([k, v]) => [k, Number(v)]),
      ),
      thumbFileId: r.thumb_file_id != null ? String(r.thumb_file_id) : null,
      thumbStatus: r.thumb_status != null ? String(r.thumb_status) : null,
      promotedByAdIds: r.promoted_by_ad_ids ? String(r.promoted_by_ad_ids).split(',') : [],
    };
  });
}

// ── Settings page: connections, assets, sync history ────────────────────────

export interface ConnectionRow {
  id: string;
  kind: string;
  status: string;
  grantedScopes: string[];
  tokenExpiresAt: string | null;
  connectedBy: string | null;
  createdAt: string;
}

/** All Meta connections for the org (usually 0 or 1 `flb` row). No tokens. */
export function listConnections(ctx: CoreCtx): Promise<ConnectionRow[]> {
  return withOrgCore(ctx, async (tx) => {
    const rows = await tx
      .select({
        id: metaConnections.id,
        kind: metaConnections.kind,
        status: metaConnections.status,
        grantedScopes: metaConnections.grantedScopes,
        tokenExpiresAt: metaConnections.tokenExpiresAt,
        connectedBy: metaConnections.connectedBy,
        createdAt: metaConnections.createdAt,
      })
      .from(metaConnections)
      .where(eq(metaConnections.orgId, ctx.tenantId))
      .orderBy(desc(metaConnections.createdAt));
    return rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      status: r.status,
      grantedScopes: Array.isArray(r.grantedScopes) ? (r.grantedScopes as string[]) : [],
      tokenExpiresAt: r.tokenExpiresAt ? r.tokenExpiresAt.toISOString() : null,
      connectedBy: r.connectedBy,
      createdAt: r.createdAt.toISOString(),
    }));
  });
}

export interface AssetRow {
  id: string;
  connectionId: string;
  kind: string;
  externalId: string;
  name: string | null;
  parentPageId: string | null;
  currency: string | null;
  enabled: boolean;
}

/** Org's connected pages/IG/ad-account assets, for the settings enable list. */
export function listAssetsWithStatus(ctx: CoreCtx): Promise<AssetRow[]> {
  return withOrgCore(ctx, async (tx) => {
    const rows = await tx
      .select({
        id: metaAssets.id,
        connectionId: metaAssets.connectionId,
        kind: metaAssets.kind,
        externalId: metaAssets.externalId,
        name: metaAssets.name,
        parentPageId: metaAssets.parentPageId,
        currency: metaAssets.currency,
        enabled: metaAssets.enabled,
      })
      .from(metaAssets)
      .where(eq(metaAssets.orgId, ctx.tenantId))
      .orderBy(metaAssets.kind, metaAssets.name);
    return rows;
  });
}

export interface SyncJobRow {
  id: string;
  kind: string;
  status: string;
  counts: Record<string, unknown>;
  error: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
}

/** Recent sync job history (all kinds), newest first, for the settings history table. */
export function syncJobHistory(ctx: CoreCtx, opts: { limit?: number } = {}): Promise<SyncJobRow[]> {
  const limit = Math.min(opts.limit ?? 20, 100);
  return withOrgCore(ctx, async (tx) => {
    const rows = await tx
      .select({
        id: metaSyncJobs.id,
        kind: metaSyncJobs.kind,
        status: metaSyncJobs.status,
        counts: metaSyncJobs.counts,
        error: metaSyncJobs.error,
        startedAt: metaSyncJobs.startedAt,
        finishedAt: metaSyncJobs.finishedAt,
        createdAt: metaSyncJobs.createdAt,
      })
      .from(metaSyncJobs)
      .where(eq(metaSyncJobs.orgId, ctx.tenantId))
      .orderBy(desc(metaSyncJobs.createdAt))
      .limit(limit);
    return rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      status: r.status,
      counts: (r.counts as Record<string, unknown>) ?? {},
      error: r.error,
      startedAt: r.startedAt ? r.startedAt.toISOString() : null,
      finishedAt: r.finishedAt ? r.finishedAt.toISOString() : null,
      createdAt: r.createdAt.toISOString(),
    }));
  });
}

// ── Campaign detail page (WP-D, spec §5.2) ──────────────────────────────────

export interface CampaignDetailAdset {
  adsetId: string;
  adsetName: string | null;
  spend: number;
  impressions: number;
  reach: number;
  clicks: number;
  ctr: number;
  cpc: number;
}

export interface CampaignDetailAd {
  adId: string;
  adName: string | null;
  spend: number;
  impressions: number;
  reach: number;
  clicks: number;
  ctr: number;
  cpc: number;
  postId: string | null;
  thumbFileId: string | null;
}

export interface CampaignSpendPoint {
  date: string;
  spend: number;
}

export interface CampaignDetail {
  campaignId: string;
  campaignName: string | null;
  totals: AdKpiTotals;
  adsets: CampaignDetailAdset[];
  ads: CampaignDetailAd[];
  spendSeries: CampaignSpendPoint[];
}

/** Full detail for one campaign: header KPI totals over `range`, per-adset and
 *  per-ad breakdown (ads carry the §4 post/thumbnail join), and a daily spend
 *  series for the trend chart. Null when the campaign has no rows at all for
 *  this org (any date) — a real 404, not merely an empty range. */
export function getCampaignDetail(ctx: CoreCtx, campaignId: string, range: DateRange): Promise<CampaignDetail | null> {
  return withOrgCore(ctx, async (tx) => {
    const [existsRow] = (await tx.execute(sql`
      select campaign_name
      from meta_ad_insights
      where org_id = ${ctx.tenantId} and campaign_id = ${campaignId}
      limit 1
    `)) as unknown as Array<{ campaign_name: string | null }>;
    if (!existsRow) return null;

    const [totalsRow] = (await tx.execute(sql`
      select coalesce(sum(spend), 0)::float8 spend,
             coalesce(sum(impressions), 0)::bigint impressions,
             coalesce(sum(reach), 0)::bigint reach,
             coalesce(sum(clicks), 0)::bigint clicks
      from meta_ad_insights
      where org_id = ${ctx.tenantId} and campaign_id = ${campaignId}
        and date >= ${range.from} and date < ${range.to}
    `)) as unknown as Array<{ spend: number; impressions: number; reach: number; clicks: number }>;
    const spend = Number(totalsRow?.spend ?? 0);
    const impressions = Number(totalsRow?.impressions ?? 0);
    const reach = Number(totalsRow?.reach ?? 0);
    const clicks = Number(totalsRow?.clicks ?? 0);

    const adsetRows = (await tx.execute(sql`
      select adset_id, max(adset_name) as adset_name,
             coalesce(sum(spend), 0)::float8 spend,
             coalesce(sum(impressions), 0)::bigint impressions,
             coalesce(sum(reach), 0)::bigint reach,
             coalesce(sum(clicks), 0)::bigint clicks
      from meta_ad_insights
      where org_id = ${ctx.tenantId} and campaign_id = ${campaignId}
        and date >= ${range.from} and date < ${range.to}
      group by adset_id
      order by spend desc
    `)) as unknown as Array<Record<string, unknown>>;

    // Same ad-level post/thumbnail join as campaignBreakdown('ad'), scoped to
    // this campaign — kept inline rather than shared to avoid coupling the two
    // call sites' surrounding aggregation shape.
    const adRows = (await tx.execute(sql`
      select mai.ad_id, max(mai.ad_name) as ad_name,
             coalesce(sum(mai.spend), 0)::float8 spend,
             coalesce(sum(mai.impressions), 0)::bigint impressions,
             coalesce(sum(mai.reach), 0)::bigint reach,
             coalesce(sum(mai.clicks), 0)::bigint clicks,
             max(map.post_id) as post_id,
             max(mm.file_id) filter (where mm.status = 'mirrored') as thumb_file_id
      from meta_ad_insights mai
      left join meta_ad_posts map on map.org_id = mai.org_id and map.ad_id = mai.ad_id
      left join meta_post_media mm on mm.org_id = map.org_id and mm.platform = map.platform and mm.post_id = map.post_id
      where mai.org_id = ${ctx.tenantId} and mai.campaign_id = ${campaignId}
        and mai.date >= ${range.from} and mai.date < ${range.to}
      group by mai.ad_id
      order by spend desc
    `)) as unknown as Array<Record<string, unknown>>;

    const spendSeriesRows = (await tx.execute(sql`
      select date::text as date, coalesce(sum(spend), 0)::float8 spend
      from meta_ad_insights
      where org_id = ${ctx.tenantId} and campaign_id = ${campaignId}
        and date >= ${range.from} and date < ${range.to}
      group by date
      order by date
    `)) as unknown as Array<{ date: string; spend: number }>;

    return {
      campaignId,
      campaignName: existsRow.campaign_name,
      totals: { spend, impressions, reach, clicks, ctr: calcCtr(clicks, impressions), cpc: calcCpc(spend, clicks) },
      adsets: adsetRows.map((r) => {
        const s = Number(r.spend ?? 0);
        const i = Number(r.impressions ?? 0);
        const c = Number(r.clicks ?? 0);
        return {
          adsetId: String(r.adset_id),
          adsetName: r.adset_name != null ? String(r.adset_name) : null,
          spend: s,
          impressions: i,
          reach: Number(r.reach ?? 0),
          clicks: c,
          ctr: calcCtr(c, i),
          cpc: calcCpc(s, c),
        };
      }),
      ads: adRows.map((r) => {
        const s = Number(r.spend ?? 0);
        const i = Number(r.impressions ?? 0);
        const c = Number(r.clicks ?? 0);
        return {
          adId: String(r.ad_id),
          adName: r.ad_name != null ? String(r.ad_name) : null,
          spend: s,
          impressions: i,
          reach: Number(r.reach ?? 0),
          clicks: c,
          ctr: calcCtr(c, i),
          cpc: calcCpc(s, c),
          postId: r.post_id != null ? String(r.post_id) : null,
          thumbFileId: r.thumb_file_id != null ? String(r.thumb_file_id) : null,
        };
      }),
      spendSeries: spendSeriesRows.map((r) => ({ date: r.date, spend: Number(r.spend) })),
    };
  });
}
