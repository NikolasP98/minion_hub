// src/server/services/meta/ad-performance.service.ts
//
// Tier 1 of IG Ad Attribution (spec 2026-07-17-ig-ad-attribution-spec.md §Tier 1).
// True ad/campaign performance from data ALREADY in meta_ad_insights — no new
// collection. The metric the org lacked: conversations started per ad/campaign
// (from the actions[] jsonb) and cost per conversation, alongside the usual
// spend/impressions/reach/clicks/ctr. Org-scoped (withOrgCore → RLS), aggregated
// in Postgres, never over raw rows in JS. Sorted by conversations_started desc.
import { sql } from 'drizzle-orm';
import { withOrgCore } from '$server/db/with-org-core';
import type { CoreCtx } from '$server/auth/core-ctx';
import { calcCtr, type DateRange } from './meta-insights.service';

/** Meta action_type whose value is "conversations started via messaging (7d)". */
const CONVO_ACTION = 'onsite_conversion.messaging_conversation_started_7d';

export interface AdPerformanceRow {
  campaignId: string | null;
  campaignName: string | null;
  /** Null on campaign-level rows. */
  adId: string | null;
  adName: string | null;
  spend: number;
  impressions: number;
  reach: number;
  clicks: number;
  /** clicks / impressions * 100. */
  ctr: number;
  conversationsStarted: number;
  /** spend / conversationsStarted, or null when no conversations (avoids ÷0). */
  costPerConversation: number | null;
}

export interface AdPerformance {
  range: DateRange;
  campaigns: AdPerformanceRow[];
  ads: AdPerformanceRow[];
}

type Tx = Parameters<Parameters<CoreCtx['db']['transaction']>[0]>[0];

/** Rollup over meta_ad_insights grouped at the requested level. conversations_started
 *  sums the numeric `value` of the messaging-conversation action inside each row's
 *  actions[] jsonb (subquery per row, then summed by the group). */
async function rollup(tx: Tx, orgId: string, r: DateRange, level: 'campaign' | 'ad'): Promise<AdPerformanceRow[]> {
  const selectAd = level === 'ad' ? sql`mai.ad_id, max(mai.ad_name) as ad_name,` : sql`null::text as ad_id, null::text as ad_name,`;
  const groupBy = level === 'ad' ? sql`mai.campaign_id, mai.ad_id` : sql`mai.campaign_id`;
  const rows = (await tx.execute(sql`
    select mai.campaign_id, max(mai.campaign_name) as campaign_name,
           ${selectAd}
           coalesce(sum(mai.spend), 0)::float8 spend,
           coalesce(sum(mai.impressions), 0)::bigint impressions,
           coalesce(sum(mai.reach), 0)::bigint reach,
           coalesce(sum(mai.clicks), 0)::bigint clicks,
           coalesce(sum((
             select sum((a->>'value')::numeric)
             from jsonb_array_elements(mai.actions) a
             where a->>'action_type' = ${CONVO_ACTION}
           )), 0)::float8 conversations_started
    from meta_ad_insights mai
    where mai.org_id = ${orgId} and mai.date >= ${r.from} and mai.date < ${r.to}
    group by ${groupBy}
    order by conversations_started desc, spend desc
    limit 500
  `)) as unknown as Array<Record<string, unknown>>;
  return rows.map((row) => {
    const spend = Number(row.spend ?? 0);
    const impressions = Number(row.impressions ?? 0);
    const clicks = Number(row.clicks ?? 0);
    const conversationsStarted = Number(row.conversations_started ?? 0);
    return {
      campaignId: row.campaign_id != null ? String(row.campaign_id) : null,
      campaignName: row.campaign_name != null ? String(row.campaign_name) : null,
      adId: row.ad_id != null ? String(row.ad_id) : null,
      adName: row.ad_name != null ? String(row.ad_name) : null,
      spend,
      impressions,
      reach: Number(row.reach ?? 0),
      clicks,
      ctr: calcCtr(clicks, impressions),
      conversationsStarted,
      costPerConversation: conversationsStarted > 0 ? spend / conversationsStarted : null,
    };
  });
}

/** Per-campaign AND per-ad performance rollup for `range`, both sorted by
 *  conversations_started desc. One withOrgCore transaction, two grouped queries. */
export function adPerformance(ctx: CoreCtx, range: DateRange): Promise<AdPerformance> {
  return withOrgCore(ctx, async (tx) => {
    const [campaigns, ads] = await Promise.all([
      rollup(tx, ctx.tenantId, range, 'campaign'),
      rollup(tx, ctx.tenantId, range, 'ad'),
    ]);
    return { range, campaigns, ads };
  });
}
