/**
 * Lead-attribution resolver + upsert — the shared core both surfaces call so a
 * backfilled row and a webhook row are byte-identical in shape. Only
 * provenance/confidence/ad_id-nullness differ. Spec:
 * specs/2026-07-17-ig-ad-attribution-spec.md.
 */
import { sql } from 'drizzle-orm';
import type { CoreCtx } from '$server/auth/core-ctx';
import { withOrgCore } from '$server/db/with-org-core';
import type { LeadAttribution, MetaReferral } from './attribution.types';

/** Resolve campaign/adset from an exact ad_id via the insights we already pull. */
export function resolveCampaignFromAdId(
  ctx: CoreCtx,
  adId: string,
): Promise<{ campaignId: string | null; campaignName: string | null; adsetId: string | null } | null> {
  return withOrgCore(ctx, async (tx) => {
    const [row] = (await tx.execute(sql`
      select campaign_id, campaign_name, adset_id
      from meta_ad_insights
      where org_id = ${ctx.tenantId} and ad_id = ${adId}
      order by date desc
      limit 1
    `)) as unknown as Array<{ campaign_id: string | null; campaign_name: string | null; adset_id: string | null }>;
    if (!row) return null;
    return { campaignId: row.campaign_id, campaignName: row.campaign_name, adsetId: row.adset_id };
  });
}

/** Webhook path: a `message.referral` → a LeadAttribution (campaign resolved). */
export async function attributionFromReferral(
  ctx: CoreCtx,
  args: {
    channel: string;
    senderId: string;
    messageId?: string | null;
    chatId?: string | null;
    firstContactAt?: string | null;
    referral: MetaReferral;
  },
): Promise<LeadAttribution> {
  const r = args.referral;
  const isAd = (r.source ?? '').toUpperCase() === 'ADS' || !!r.ad_id;
  const resolved = r.ad_id ? await resolveCampaignFromAdId(ctx, r.ad_id) : null;
  return {
    orgId: ctx.tenantId,
    channel: args.channel,
    senderId: args.senderId,
    chatId: args.chatId ?? null,
    firstMessageId: args.messageId ?? null,
    firstContactAt: args.firstContactAt ?? null,
    origin: isAd ? 'ad' : 'organic',
    source: r.source ?? (isAd ? 'ADS' : null),
    ref: r.ref ?? null,
    adId: r.ad_id ?? null,
    adsetId: resolved?.adsetId ?? null,
    campaignId: resolved?.campaignId ?? null,
    campaignName: resolved?.campaignName ?? null,
    adTitle: r.ads_context_data?.ad_title ?? null,
    photoUrl: r.ads_context_data?.photo_url ?? null,
    videoUrl: r.ads_context_data?.video_url ?? null,
    provenance: 'webhook',
    confidence: 'exact',
    matchMeta: {},
  };
}

const UPSERT_SET = sql`do update set
        chat_id = excluded.chat_id,
        first_message_id = excluded.first_message_id,
        first_contact_at = coalesce(meta_lead_attribution.first_contact_at, excluded.first_contact_at),
        origin = excluded.origin,
        source = excluded.source,
        ref = excluded.ref,
        ad_id = excluded.ad_id,
        adset_id = excluded.adset_id,
        campaign_id = excluded.campaign_id,
        campaign_name = excluded.campaign_name,
        ad_title = excluded.ad_title,
        photo_url = excluded.photo_url,
        video_url = excluded.video_url,
        provenance = excluded.provenance,
        confidence = excluded.confidence,
        match_meta = excluded.match_meta,
        updated_at = now()
      -- webhook is authoritative; don't let a heuristic overwrite a webhook row
      where meta_lead_attribution.provenance <> 'webhook' or excluded.provenance = 'webhook'`;

const rowValues = (orgId: string, a: LeadAttribution) => sql`(
  ${orgId}, ${a.channel}, ${a.senderId}, ${a.chatId ?? null},
  ${a.firstMessageId ?? null}, ${a.firstContactAt ?? null},
  ${a.origin}, ${a.source ?? null}, ${a.ref ?? null}, ${a.adId ?? null},
  ${a.adsetId ?? null}, ${a.campaignId ?? null}, ${a.campaignName ?? null},
  ${a.adTitle ?? null}, ${a.photoUrl ?? null}, ${a.videoUrl ?? null},
  ${a.provenance}, ${a.confidence}, ${JSON.stringify(a.matchMeta ?? {})}::jsonb
)`;

/**
 * Batched upsert — one transaction, one GUC set, chunked multi-row inserts. For
 * the Tier-2 backfill (thousands of rows): per-row `upsertLeadAttribution` opens
 * a transaction per row (a network round-trip each), which is ~100× slower. Same
 * webhook-wins conflict rule.
 */
export function upsertLeadAttributionBatch(ctx: CoreCtx, rows: LeadAttribution[], chunkSize = 500): Promise<void> {
  return withOrgCore(ctx, async (tx) => {
    for (let i = 0; i < rows.length; i += chunkSize) {
      const chunk = rows.slice(i, i + chunkSize);
      const values = sql.join(
        chunk.map((a) => rowValues(ctx.tenantId, a)),
        sql`, `,
      );
      await tx.execute(sql`
        insert into meta_lead_attribution (
          org_id, channel, sender_id, chat_id, first_message_id, first_contact_at,
          origin, source, ref, ad_id, adset_id, campaign_id, campaign_name,
          ad_title, photo_url, video_url, provenance, confidence, match_meta
        ) values ${values}
        on conflict (org_id, channel, sender_id) ${UPSERT_SET}
      `);
    }
  });
}

/**
 * Upsert a lead attribution. Webhook rows are authoritative: a
 * `heuristic-icebreaker` upsert never overwrites an existing `webhook` row, but
 * a `webhook` row always wins (overwrites any prior heuristic guess).
 */
export function upsertLeadAttribution(ctx: CoreCtx, a: LeadAttribution): Promise<void> {
  return withOrgCore(ctx, async (tx) => {
    await tx.execute(sql`
      insert into meta_lead_attribution (
        org_id, channel, sender_id, chat_id, first_message_id, first_contact_at,
        origin, source, ref, ad_id, adset_id, campaign_id, campaign_name,
        ad_title, photo_url, video_url, provenance, confidence, match_meta
      ) values (
        ${ctx.tenantId}, ${a.channel}, ${a.senderId}, ${a.chatId ?? null},
        ${a.firstMessageId ?? null}, ${a.firstContactAt ?? null},
        ${a.origin}, ${a.source ?? null}, ${a.ref ?? null}, ${a.adId ?? null},
        ${a.adsetId ?? null}, ${a.campaignId ?? null}, ${a.campaignName ?? null},
        ${a.adTitle ?? null}, ${a.photoUrl ?? null}, ${a.videoUrl ?? null},
        ${a.provenance}, ${a.confidence}, ${JSON.stringify(a.matchMeta ?? {})}::jsonb
      )
      on conflict (org_id, channel, sender_id) do update set
        chat_id = excluded.chat_id,
        first_message_id = excluded.first_message_id,
        first_contact_at = coalesce(meta_lead_attribution.first_contact_at, excluded.first_contact_at),
        origin = excluded.origin,
        source = excluded.source,
        ref = excluded.ref,
        ad_id = excluded.ad_id,
        adset_id = excluded.adset_id,
        campaign_id = excluded.campaign_id,
        campaign_name = excluded.campaign_name,
        ad_title = excluded.ad_title,
        photo_url = excluded.photo_url,
        video_url = excluded.video_url,
        provenance = excluded.provenance,
        confidence = excluded.confidence,
        match_meta = excluded.match_meta,
        updated_at = now()
      -- webhook is authoritative; don't let a heuristic overwrite a webhook row
      where meta_lead_attribution.provenance <> 'webhook' or excluded.provenance = 'webhook'
    `);
  });
}
