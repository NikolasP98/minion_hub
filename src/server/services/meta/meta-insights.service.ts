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
}

/** Grouped campaign/adset/ad spend+performance for `range`. Aggregation runs in
 *  Postgres (group by the requested level) — the client only sorts/filters the
 *  already-small grouped result, never raw daily rows. */
export function campaignBreakdown(ctx: CoreCtx, range: DateRange, level: CampaignLevel = 'ad'): Promise<CampaignRow[]> {
  // Fixed 3-way enum, not user SQL — safe to splice as raw fragments.
  const selectAdset = level === 'campaign' ? sql`null::text as adset_id, null::text as adset_name,` : sql`adset_id, max(adset_name) as adset_name,`;
  const selectAd = level === 'ad' ? sql`ad_id, max(ad_name) as ad_name,` : sql`null::text as ad_id, null::text as ad_name,`;
  const groupBy =
    level === 'campaign' ? sql`campaign_id` : level === 'adset' ? sql`campaign_id, adset_id` : sql`campaign_id, adset_id, ad_id`;
  return withOrgCore(ctx, async (tx) => {
    const rows = (await tx.execute(sql`
      select campaign_id, max(campaign_name) as campaign_name,
             ${selectAdset}
             ${selectAd}
             coalesce(sum(spend), 0)::float8 spend,
             coalesce(sum(impressions), 0)::bigint impressions,
             coalesce(sum(reach), 0)::bigint reach,
             coalesce(sum(clicks), 0)::bigint clicks
      from meta_ad_insights
      where org_id = ${ctx.tenantId} and date >= ${range.from} and date < ${range.to}
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
  const platformCond = opts.platform ? sql` and platform = ${opts.platform}` : sql``;
  const promotedCond = opts.promoted === undefined ? sql`` : sql` and is_promoted = ${opts.promoted}`;
  const orderClause = opts.orderBy === 'recent' ? sql`posted_at desc nulls last` : sql`score desc nulls last`;
  return withOrgCore(ctx, async (tx) => {
    const rows = (await tx.execute(sql`
      select post_id,
             max(platform) as platform,
             max(permalink) as permalink,
             max(caption) as caption,
             max(posted_at)::text as posted_at,
             max(media_type) as media_type,
             bool_or(is_promoted) as is_promoted,
             jsonb_object_agg(metric, value) as metrics,
             sum(value)::float8 as score
      from meta_post_insights
      where org_id = ${ctx.tenantId} and period = 'lifetime'${platformCond}${promotedCond}
      group by post_id
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
    }));
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
