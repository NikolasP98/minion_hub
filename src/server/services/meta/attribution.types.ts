/**
 * Canonical lead-attribution shapes — the ONE contract shared by both
 * collection surfaces (exact webhook + retroactive heuristic). See
 * specs/2026-07-17-ig-ad-attribution-spec.md.
 */

/** Meta IG Click-to-Direct `message.referral` (verbatim webhook shape). */
export interface MetaReferral {
  ref?: string | null;
  ad_id?: string | null;
  source?: string | null; // 'ADS'
  type?: string | null; // 'OPEN_THREAD'
  ads_context_data?: {
    ad_title?: string | null;
    photo_url?: string | null;
    video_url?: string | null;
  } | null;
}

export type AttributionOrigin = 'ad' | 'organic' | 'unknown';
export type AttributionProvenance = 'webhook' | 'heuristic-icebreaker';
export type AttributionConfidence = 'exact' | 'high' | 'medium' | 'low';

/** A row destined for `meta_lead_attribution` — identical from both surfaces. */
export interface LeadAttribution {
  orgId: string;
  channel: string; // 'instagram'
  senderId: string;
  chatId?: string | null;
  firstMessageId?: string | null;
  firstContactAt?: string | null; // ISO
  origin: AttributionOrigin;
  source?: string | null;
  ref?: string | null;
  adId?: string | null;
  adsetId?: string | null;
  campaignId?: string | null;
  campaignName?: string | null;
  adTitle?: string | null;
  photoUrl?: string | null;
  videoUrl?: string | null;
  provenance: AttributionProvenance;
  confidence: AttributionConfidence;
  matchMeta?: Record<string, unknown>;
}

/** Payload the gateway relays to POST /api/meta/attribution on an ad referral. */
export interface AttributionRelayBody {
  channel: string; // 'instagram'
  senderId: string;
  recipientId: string; // IG business id → org via meta_assets
  messageId?: string | null;
  chatId?: string | null;
  timestampMs?: number | null;
  referral: MetaReferral;
}
