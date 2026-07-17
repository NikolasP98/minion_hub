/**
 * Tier-2 heuristic classifier + product→campaign matcher for IG-DM lead
 * attribution (spec 2026-07-17-ig-ad-attribution-spec.md §"Tier 2").
 *
 * Meta injects a per-campaign ICEBREAKER as the lead's first DM ("Hola, vi su
 * anuncio de …", "quiero más información sobre …", "info de Slimface"). That
 * opener names the advertised product, so we (a) classify the opener into
 * ad/organic/unknown + extract the product keyword, then (b) match the product
 * to the IG-DM message campaign that was live when the lead first wrote.
 */
import { sql } from 'drizzle-orm';
import type { CoreCtx } from '$server/auth/core-ctx';
import { withOrgCore } from '$server/db/with-org-core';
import type { AttributionOrigin } from './attribution.types';

/** Result of classifying a lead's opener text (before any DB lookup). */
export interface OpenerClass {
  /** Tentative origin from the text alone ('ad' still needs campaign resolution). */
  origin: AttributionOrigin;
  isAd: boolean;
  /** Canonical product tag (key into PRODUCT_CAMPAIGN_PATTERNS) or null. */
  product: string | null;
  /** Text-only confidence: strong when a product is named, weak for a bare ad
   *  template, none when there's no ad signal. Refined by the campaign match. */
  confidenceHint: 'high' | 'low' | 'none';
}

/** One IG-DM message campaign with its active span + conversations started. */
export interface IgDmCampaign {
  campaignId: string | null;
  campaignName: string;
  /** Active span (min/max insight date), YYYY-MM-DD. */
  from: string;
  to: string;
  convosStarted: number;
}

/** A resolved campaign for a product, within the lead's first-contact window. */
export interface CampaignMatch {
  campaignId: string | null;
  campaignName: string;
  /** The matched campaign's active span [minDate, maxDate] (YYYY-MM-DD). */
  window: { from: string; to: string };
  /** Other product campaigns that also covered the contact time (ambiguity). */
  competitors: string[];
  convosStarted: number;
  /** 'high' = single product campaign; 'medium' = multiple candidates. */
  confidence: 'high' | 'medium';
}

/** Strip accents + lowercase so "información" and "informacion" match one rule. */
function deaccent(s: string): string {
  return s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
}

// Product keyword → canonical tag. Scanned in order (specific before the
// catch-all slim), first hit wins. "Afinamiento de Rostro" is the icebreaker
// wording for the Slimface product, so it maps to slimface.
const PRODUCT_KEYWORDS: Array<{ tag: string; kw: RegExp }> = [
  { tag: 'rino', kw: /rino|rinosculpt|rinomodel|nariz/ },
  { tag: 'labios', kw: /labio/ },
  { tag: 'menton', kw: /menton/ },
  { tag: 'papada', kw: /papada/ },
  { tag: 'slimface', kw: /slim|afinamiento|afina\s+(de\s+)?rostro/ },
];

/** Canonical product tag → campaign_name ILIKE patterns (any-of). */
export const PRODUCT_CAMPAIGN_PATTERNS: Record<string, string[]> = {
  slimface: ['%slim%', '%afinamiento%'],
  labios: ['%labio%'],
  rino: ['%rino%'],
  menton: ['%ment%'],
  papada: ['%papada%'],
};

// An ad-template opener: names an "anuncio", or the "(quiero) información
// sobre/de …" / "info de …" request Meta seeds. Bare "Información" (no
// sobre/de) is NOT counted — too ambiguous to call an ad.
const AD_PHRASE =
  /anuncio|informacion\s+(sobre|de|acerca)|\binfo\s+(de|sobre)|(quiero|quisiera)\b[\s\S]*informacion/;

/**
 * Classify a first-DM opener. Ad iff it names a product OR reads as an ad
 * template. Empty/media-only → unknown; any other text → organic.
 */
export function classifyOpener(opener: string): OpenerClass {
  const raw = (opener ?? '').trim();
  if (raw === '') return { origin: 'unknown', isAd: false, product: null, confidenceHint: 'none' };

  const norm = deaccent(raw);
  const product = PRODUCT_KEYWORDS.find((p) => p.kw.test(norm))?.tag ?? null;
  const isAd = product !== null || AD_PHRASE.test(norm);

  if (!isAd) return { origin: 'organic', isAd: false, product: null, confidenceHint: 'none' };
  return { origin: 'ad', isAd: true, product, confidenceHint: product ? 'high' : 'low' };
}

const DAY_MS = 86_400_000;

/**
 * Load every IG-DM/instagram/mensajes message campaign with conversations
 * started, as one grouped query. The backfill loads this ONCE and matches each
 * lead in memory (`pickCampaign`) — a per-lead SQL round-trip would be
 * thousands of transactions.
 */
export function loadIgDmCampaigns(ctx: CoreCtx): Promise<IgDmCampaign[]> {
  // conversations_started = sum of the 7-day messaging-conversation-started
  // action value on each ad×day row (same metric as ad-performance rollups).
  const convos = sql`(
    select coalesce(sum((a->>'value')::numeric), 0)
    from jsonb_array_elements(actions) a
    where a->>'action_type' = 'onsite_conversion.messaging_conversation_started_7d'
  )`;
  return withOrgCore(ctx, async (tx) => {
    const rows = (await tx.execute(sql`
      select campaign_id, campaign_name,
             min(date)::text as mn, max(date)::text as mx,
             sum(${convos})::float8 as convos
      from meta_ad_insights
      where org_id = ${ctx.tenantId}
        and (campaign_name ilike '%IG-DM%' or campaign_name ilike '%instagram%' or campaign_name ilike '%mensajes%')
        -- IG-DM leads can only originate from IG campaigns; a same-product
        -- WhatsApp campaign is channel-impossible here and must not count as a
        -- competing candidate (it spuriously downgrades confidence high→medium).
        and campaign_name not ilike '%whatsapp%'
        and campaign_name not ilike '%wssp%'
      group by campaign_id, campaign_name
      having sum(${convos}) > 0
    `)) as unknown as Array<{ campaign_id: string | null; campaign_name: string; mn: string; mx: string; convos: number }>;
    return rows.map((r) => ({
      campaignId: r.campaign_id,
      campaignName: r.campaign_name,
      from: r.mn,
      to: r.mx,
      convosStarted: Number(r.convos),
    }));
  });
}

/** '%slim%' → substring test 'slim'; matches how ILIKE '%x%' behaves. */
function ilikeContains(name: string, pattern: string): boolean {
  return name.toLowerCase().includes(pattern.replace(/%/g, '').toLowerCase());
}

/**
 * Pick the campaign that was live for a product when the lead first wrote:
 * name matches one of the product's ILIKE patterns AND the lead's first-contact
 * time falls within the campaign span [from, to+7d]. Picks the campaign with
 * the most conversations started (strongest prior); >1 candidate → 'medium',
 * single → 'high'. Pure — no DB.
 */
export function pickCampaign(
  campaigns: IgDmCampaign[],
  product: string,
  firstContactAt: string,
): CampaignMatch | null {
  const patterns = PRODUCT_CAMPAIGN_PATTERNS[product];
  if (!patterns || patterns.length === 0) return null;
  const contact = Date.parse(firstContactAt);
  if (Number.isNaN(contact)) return null;
  const matches = campaigns
    .filter(
      (c) =>
        patterns.some((p) => ilikeContains(c.campaignName, p)) &&
        contact >= Date.parse(`${c.from}T00:00:00Z`) &&
        contact < Date.parse(`${c.to}T00:00:00Z`) + 7 * DAY_MS,
    )
    .sort((a, b) => b.convosStarted - a.convosStarted);
  if (matches.length === 0) return null;
  const top = matches[0];
  return {
    campaignId: top.campaignId,
    campaignName: top.campaignName,
    window: { from: top.from, to: top.to },
    competitors: matches.slice(1).map((c) => c.campaignName),
    convosStarted: top.convosStarted,
    confidence: matches.length > 1 ? 'medium' : 'high',
  };
}

/**
 * Single-shot convenience: load candidates + pick. For non-batch callers; the
 * batch backfill uses loadIgDmCampaigns + pickCampaign to avoid N queries.
 */
export async function matchCampaignForProduct(
  ctx: CoreCtx,
  product: string,
  firstContactAt: string,
): Promise<CampaignMatch | null> {
  return pickCampaign(await loadIgDmCampaigns(ctx), product, firstContactAt);
}

// ── self-check: `bun src/server/services/meta/attribution-heuristic.ts` ──────
if (import.meta.main) {
  const cases: Array<[string, AttributionOrigin, boolean, string | null]> = [
    ['Hola, vi su anuncio de Afinamiento de Rostro 🫶', 'ad', true, 'slimface'],
    ['Hola, quisiera mas información de SlimFace 🤎', 'ad', true, 'slimface'],
    ['Hola, quiero info de Slimface 💫', 'ad', true, 'slimface'],
    ['Hola, quiero más información sobre Rinomodelación', 'ad', true, 'rino'],
    ['¿Cuánto cuesta RinoSculpt?', 'ad', true, 'rino'],
    ['Información sobre labios', 'ad', true, 'labios'],
    ['Mi anuncio?', 'ad', true, null],
    ['¿Cuánto cuestan las sesiones?', 'organic', false, null],
    ['Información', 'organic', false, null],
    ['Hola', 'organic', false, null],
    ['   ', 'unknown', false, null],
    ['', 'unknown', false, null],
  ];
  for (const [opener, origin, isAd, product] of cases) {
    const r = classifyOpener(opener);
    if (r.origin !== origin || r.isAd !== isAd || r.product !== product) {
      throw new Error(
        `classifyOpener(${JSON.stringify(opener)}) => ${JSON.stringify(r)} expected {origin:${origin},isAd:${isAd},product:${product}}`,
      );
    }
  }
  console.log(`classifyOpener self-check passed (${cases.length} cases)`);
}
