/**
 * Tier-2 retroactive backfill runner (spec 2026-07-17-ig-ad-attribution-spec.md
 * §"Tier 2"). Walks the FIRST inbound Instagram DM per chat, classifies its
 * opener, resolves the ad campaign that was live, and produces canonical
 * `LeadAttribution` rows with provenance='heuristic-icebreaker'.
 *
 * DRY-RUN aggregates buckets + per-campaign lead totals + samples and writes
 * NOTHING; the real apply upserts each row via the shared (webhook-authoritative)
 * upsert. Shape is identical to the webhook surface — only provenance/confidence
 * and the null ad_id differ.
 */
import { sql } from 'drizzle-orm';
import type { CoreCtx } from '$server/auth/core-ctx';
import { withOrgCore } from '$server/db/with-org-core';
import type { AttributionConfidence, LeadAttribution } from './attribution.types';
import { upsertLeadAttributionBatch } from './attribution.service';
import { classifyOpener, loadIgDmCampaigns, pickCampaign, type CampaignMatch } from './attribution-heuristic';

interface FirstMessageRow {
  chat_id: string;
  sender_id: string | null;
  message_id: string | null;
  content: string | null;
  first_at: Date | string | null;
}

export interface BackfillSample {
  senderId: string;
  opener: string | null;
  product: string | null;
  origin: LeadAttribution['origin'];
  confidence: AttributionConfidence;
  campaignName: string | null;
}

export interface BackfillReport {
  dryRun: boolean;
  total: number;
  /** Counts per bucket: ad-high | ad-medium | ad-low | organic | unknown. */
  buckets: Record<string, number>;
  /** Lead totals per resolved campaign, most leads first. */
  perCampaign: Array<{ campaignName: string; leads: number }>;
  /** Up to 20 illustrative rows (a spread across buckets). */
  samples: BackfillSample[];
  /** Attribution for specifically-requested sender ids (sanity checks). */
  spotlight: BackfillSample[];
}

function bucketOf(a: LeadAttribution): string {
  return a.origin === 'ad' ? `ad-${a.confidence}` : a.origin;
}

function toSample(a: LeadAttribution): BackfillSample {
  return {
    senderId: a.senderId,
    opener: (a.matchMeta?.opener as string | null) ?? null,
    product: (a.matchMeta?.product as string | null) ?? null,
    origin: a.origin,
    confidence: a.confidence,
    campaignName: a.campaignName ?? null,
  };
}

function buildAttribution(ctx: CoreCtx, row: FirstMessageRow, match: CampaignMatch | null): LeadAttribution {
  const cls = classifyOpener(row.content ?? '');
  const origin = cls.isAd ? 'ad' : cls.origin;
  // A named-product single campaign is 'high'/'medium' (from the match); a bare
  // ad template, or an ad we couldn't resolve to a campaign, is 'low'. Organic /
  // unknown carry 'low' too — a weak, no-signal record, not a claim.
  const confidence: AttributionConfidence = cls.isAd && match ? match.confidence : 'low';
  const firstAt = row.first_at ? new Date(row.first_at).toISOString() : null;
  return {
    orgId: ctx.tenantId,
    channel: 'instagram',
    senderId: row.sender_id ?? row.chat_id,
    chatId: row.chat_id,
    firstMessageId: row.message_id ?? null,
    firstContactAt: firstAt,
    origin,
    source: cls.isAd ? 'ADS' : null,
    ref: null,
    adId: null,
    adsetId: null,
    campaignId: match?.campaignId ?? null,
    campaignName: match?.campaignName ?? null,
    adTitle: null,
    photoUrl: null,
    videoUrl: null,
    provenance: 'heuristic-icebreaker',
    confidence,
    matchMeta: {
      opener: row.content ?? null,
      product: cls.product,
      window: match?.window ?? null,
      competitors: match?.competitors ?? [],
      convos_started: match?.convosStarted ?? null,
    },
  };
}

/**
 * Backfill lead attribution over every first inbound IG DM. In dry-run, returns
 * a report and writes nothing; otherwise upserts each row.
 */
export async function runBackfill(
  ctx: CoreCtx,
  opts: { dryRun: boolean; spotlightSenderIds?: string[] },
): Promise<BackfillReport> {
  const spotlightSet = new Set(opts.spotlightSenderIds ?? []);

  // Candidate campaigns once, matched per-lead in memory (pure pickCampaign).
  const campaigns = await loadIgDmCampaigns(ctx);

  // First inbound per chat: min(occurred_at) via DISTINCT ON. Its occurred_at is
  // the first-contact time (spec: first_contact_at = min occurred_at).
  const firsts = (await withOrgCore(ctx, async (tx) => {
    return (await tx.execute(sql`
      select distinct on (chat_id)
             chat_id, sender_id, message_id, content,
             coalesce(occurred_at, created_at) as first_at
      from messages
      where org_id = ${ctx.tenantId} and channel = 'instagram'
        and direction = 'inbound' and chat_id is not null
      order by chat_id, coalesce(occurred_at, created_at) asc
    `)) as unknown as FirstMessageRow[];
  })) as FirstMessageRow[];

  const buckets: Record<string, number> = {};
  const perCampaign = new Map<string, number>();
  const samples: BackfillSample[] = [];
  const perBucketSampled: Record<string, number> = {};
  const spotlight: BackfillSample[] = [];
  const toWrite: LeadAttribution[] = [];

  for (const row of firsts) {
    const cls = classifyOpener(row.content ?? '');
    const firstAtIso = row.first_at ? new Date(row.first_at).toISOString() : null;
    const match = cls.isAd && cls.product && firstAtIso ? pickCampaign(campaigns, cls.product, firstAtIso) : null;
    const a = buildAttribution(ctx, row, match);

    const bucket = bucketOf(a);
    buckets[bucket] = (buckets[bucket] ?? 0) + 1;
    if (a.campaignName) perCampaign.set(a.campaignName, (perCampaign.get(a.campaignName) ?? 0) + 1);

    // Up to 4 samples per bucket → a spread of ≤20 illustrative rows.
    if ((perBucketSampled[bucket] ?? 0) < 4 && samples.length < 20) {
      perBucketSampled[bucket] = (perBucketSampled[bucket] ?? 0) + 1;
      samples.push(toSample(a));
    }
    if (spotlightSet.has(a.senderId)) spotlight.push(toSample(a));

    if (!opts.dryRun) toWrite.push(a);
  }

  // One batched, chunked upsert — per-row transactions are ~100× slower.
  if (!opts.dryRun && toWrite.length) await upsertLeadAttributionBatch(ctx, toWrite);

  return {
    dryRun: opts.dryRun,
    total: firsts.length,
    buckets,
    perCampaign: [...perCampaign.entries()]
      .map(([campaignName, leads]) => ({ campaignName, leads }))
      .sort((x, y) => y.leads - x.leads),
    samples,
    spotlight,
  };
}
