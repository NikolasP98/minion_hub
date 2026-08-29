/**
 * ICP (Ideal Customer Profile) fit — the SHARED contract for spec
 * 2026-08-03-crm-icp-score-spec, S1. Pure helpers + Zod schemas, no I/O and no
 * paraglide, exactly like its `crm-relationship.ts` / `crm-funnel.ts` siblings,
 * so the server (settings boundary, judge, tick) and the client (roster column,
 * settings editor) share ONE definition of the shape and can both be
 * unit-tested without SvelteKit aliases.
 *
 * Two blobs live under this contract, both on existing jsonb columns (the spec
 * mandates ZERO DDL):
 *
 * - `crm_settings.value.icp` — the org's own definition of an ideal customer
 *   ({@link IcpDefinition}). Missing or unconfigured ⇒ the whole feature is OFF
 *   for that org: no column, no tick work, no LLM spend (see
 *   {@link isIcpConfigured}).
 * - `crm_contacts.custom_fields._icp` — the per-contact verdict
 *   ({@link IcpResult}). `_icpClaim` (sibling reserved key) is the internal
 *   expiring inference lease and is NEVER serialised to any principal — see
 *   `sanitizeContactFields` in `$lib/pii`.
 *
 * `icp` is orthogonal to the existing RFM `score`: `score` measures ENGAGEMENT
 * (behavioural, SQL, untouched by any of this), `icp` measures FIT. A dormant
 * perfect-fit lead and a chatty bad-fit tyre-kicker are the two cases the
 * single RFM score cannot tell apart.
 */
import { z } from 'zod';

// ── Reserved custom_fields keys ─────────────────────────────────────────────
// Both are `_`-prefixed, so `isReservedMetaKey` already hides them from the
// meta-column editor and `customFieldsMergeSql` already refuses to let a client
// PATCH forge or delete them. Named constants so no call site re-types the
// string (a typo'd `'_icpclaim'` in the strip list is a silent PII leak).

/** The per-contact verdict blob. */
export const ICP_KEY = '_icp';
/** The internal expiring inference lease. Never user-facing, never serialised. */
export const ICP_CLAIM_KEY = '_icpClaim';

// ── Bounds ──────────────────────────────────────────────────────────────────
// Every collection and every free-text field is bounded in BOTH directions:
// these caps are what stops an org-authored definition from growing the judge
// prompt (and its bill) without limit, and what stops a model-authored result
// from growing the jsonb column that the roster query projects on every page.

/** Max chars of the org's free-text "who is our ideal customer" description. */
export const ICP_DESCRIPTION_MAX = 2000;
/** Max weighted criteria. Each one is a line in the judge prompt AND a row in
 *  the explainability popover; 8 is the spec's cap. */
export const ICP_CRITERIA_MAX = 8;
/** Max chars of one criterion's human label. */
export const ICP_CRITERION_LABEL_MAX = 200;
/** Max chars of one criterion's slug id. */
export const ICP_CRITERION_ID_MAX = 40;
/** Relative weight bounds (integer). Weights are interpreted BY THE MODEL
 *  against the org's own criteria, not blended by a formula here — see §4 of
 *  the spec for why a numeric blend across org-authored free text would be
 *  false precision. */
export const ICP_WEIGHT_MIN = 1;
export const ICP_WEIGHT_MAX = 5;
/** Max disqualifiers ("only ever asks for free consults"). */
export const ICP_DISQUALIFIERS_MAX = 5;
/** Max chars of one disqualifier. */
export const ICP_DISQUALIFIER_MAX = 200;

/** Max chars of a per-criterion note written by the judge. */
export const ICP_NOTE_MAX = 140;
/** Max reasons the judge may return. */
export const ICP_REASONS_MAX = 3;
/** Max chars of one reason. */
export const ICP_REASON_MAX = 200;
/** Max evidence refs stored. Refs only — raw conversation text is NEVER
 *  persisted here (same ruling as the relationship graph). */
export const ICP_EVIDENCE_REFS_MAX = 10;

/**
 * A criterion id must be a stable slug: it is the join key between the org's
 * definition and the judge's per-criterion verdict, so it has to survive a
 * relabel. Lowercase alphanumerics plus `-`/`_`.
 */
export const ICP_CRITERION_ID_RE = /^[a-z0-9][a-z0-9_-]*$/;

// ── Bands ───────────────────────────────────────────────────────────────────

/** Fit bands. `disqualified` is NOT a threshold of the same ramp — it is a
 *  short-circuit set by a disqualifier match (see {@link icpVerdict}). */
export const ICP_BANDS = ['strong', 'moderate', 'weak', 'disqualified'] as const;
export type IcpBand = (typeof ICP_BANDS)[number];

/**
 * Band thresholds, deliberately the SAME breakpoints as the RFM ramp
 * (`scoreColor` / `temperatureOf` in `crm-format.ts`: 75 / 50). The two scores
 * sit side by side in the roster, so a 76 reading "top band" in one column and
 * "middle band" in the other would be a UI lie, not a nuance.
 */
export const ICP_STRONG_MIN = 75;
export const ICP_MODERATE_MIN = 50;

/** A disqualified contact's score is CLAMPED to this ceiling (spec §4). */
export const ICP_DISQUALIFIED_SCORE_MAX = 10;

/** Score bounds. Any judge output outside this range is a contract violation,
 *  not something to clamp silently — {@link icpResultSchema} rejects it. */
export const ICP_SCORE_MIN = 0;
export const ICP_SCORE_MAX = 100;

/**
 * Score → band for a NON-disqualified contact. Prefer {@link icpVerdict}: it
 * is impossible to apply the disqualifier short-circuit to one of the two
 * fields and forget the other.
 */
export function icpBandForScore(score: number): Exclude<IcpBand, 'disqualified'> {
  if (score >= ICP_STRONG_MIN) return 'strong';
  if (score >= ICP_MODERATE_MIN) return 'moderate';
  return 'weak';
}

/**
 * The ONE place a raw judge score becomes a stored `{ score, band }` pair.
 *
 * `disqualified: true` short-circuits BOTH fields together (spec §4): the band
 * becomes `disqualified` and the score is clamped to at most
 * {@link ICP_DISQUALIFIED_SCORE_MAX}, so a model that answers "82, but they
 * match the disqualifier" can never leave an 82 sitting in a column that sorts
 * fit descending. A model score below the cap is kept as-is — a disqualified
 * contact scored 3 is not promoted to 10.
 *
 * Out-of-range and non-finite scores are clamped/zeroed here rather than
 * thrown, because this runs on model output: the schema is the boundary that
 * REJECTS a malformed result, this is the normalizer that produces a valid one.
 */
export function icpVerdict(input: { score: number; disqualified?: boolean }): {
  score: number;
  band: IcpBand;
} {
  const raw = Number.isFinite(input.score) ? input.score : ICP_SCORE_MIN;
  const bounded = Math.min(ICP_SCORE_MAX, Math.max(ICP_SCORE_MIN, Math.round(raw)));
  if (input.disqualified) {
    return { score: Math.min(bounded, ICP_DISQUALIFIED_SCORE_MAX), band: 'disqualified' };
  }
  return { score: bounded, band: icpBandForScore(bounded) };
}

// ── The org definition (`crm_settings.value.icp`) ───────────────────────────

/**
 * WRITE boundary — STRICT, and the only schema an HTTP handler may parse with.
 *
 * Unknown keys are rejected; `version` and `updatedAt` are NOT client-supplyable
 * (the server stamps `updatedAt` and Postgres derives the next `version` from
 * the stored row — see `saveIcpDefinition`, a client-chosen version could
 * silently un-invalidate every cached score). Over-cap input is REJECTED rather
 * than clamped, mirroring `depositWriteSchema`: an operator who types a 9th
 * criterion is told, not quietly given 8.
 */
export const icpDefinitionWriteSchema = z
  .object({
    description: z.string().trim().max(ICP_DESCRIPTION_MAX),
    criteria: z
      .array(
        z
          .object({
            id: z.string().trim().min(1).max(ICP_CRITERION_ID_MAX).regex(ICP_CRITERION_ID_RE),
            label: z.string().trim().min(1).max(ICP_CRITERION_LABEL_MAX),
            weight: z.number().int().min(ICP_WEIGHT_MIN).max(ICP_WEIGHT_MAX),
          })
          .strict(),
      )
      .max(ICP_CRITERIA_MAX)
      // Ids are the join key between the definition and each criterion verdict;
      // two criteria sharing one id makes `criteria[].met` ambiguous forever.
      .refine((c) => new Set(c.map((x) => x.id)).size === c.length, {
        message: 'criteria ids must be unique',
      }),
    disqualifiers: z
      .array(z.string().trim().min(1).max(ICP_DISQUALIFIER_MAX))
      .max(ICP_DISQUALIFIERS_MAX),
  })
  .strict();

/** The client-supplyable half of an ICP definition. */
export type IcpDefinitionInput = z.infer<typeof icpDefinitionWriteSchema>;

/**
 * The STORED shape: the write shape plus the two server-owned bookkeeping
 * fields. `version` is what invalidates every cached per-contact score, so it
 * is a positive integer that only ever moves forward.
 */
export const icpDefinitionSchema = icpDefinitionWriteSchema.safeExtend({
  version: z.number().int().min(1),
  updatedAt: z.iso.datetime(),
});
export type IcpDefinition = z.infer<typeof icpDefinitionSchema>;

/**
 * Is the feature ON for this org?
 *
 * The spec's gate is "missing/empty `icp`" — every field of the definition,
 * `disqualifiers` included, so an org that has authored only exclusion rules
 * (no positive description or criteria) still counts as configured: those
 * rules drive the disqualified short-circuit in {@link icpVerdict} even with
 * nothing to score positively against. Only a definition that is empty in
 * ALL THREE fields is unconfigured, exactly like a missing key: no column, no
 * tick work, no LLM spend (spec §3.1 and acceptance criterion 1). This is
 * also how an org turns the feature back off: save a fully empty definition.
 */
export function isIcpConfigured(def: IcpDefinition | null | undefined): def is IcpDefinition {
  if (!def) return false;
  return (
    def.description.trim().length > 0 || def.criteria.length > 0 || def.disqualifiers.length > 0
  );
}

// ── The per-contact result (`crm_contacts.custom_fields._icp`) ──────────────

const icpEvidenceRefSchema = z.object({ chunkId: z.string() }).strict();

/**
 * The stored `_icp` blob. `null` is a legitimate stored value: it is what the
 * skip gate writes for a contact with neither messages nor commercial history
 * (spec §4), i.e. "evaluated, nothing to judge" — distinct from an absent key
 * ("never evaluated").
 *
 * Note what is NOT here: raw conversation text. `evidenceRefs` carries chunk
 * ids only, so the cached blob that gets serialised to browsers can never
 * become a copy of a private conversation.
 */
export const icpResultSchema = z
  .object({
    score: z.number().min(ICP_SCORE_MIN).max(ICP_SCORE_MAX),
    band: z.enum(ICP_BANDS),
    criteria: z
      .array(
        z
          .object({
            id: z.string().min(1).max(ICP_CRITERION_ID_MAX),
            met: z.boolean(),
            note: z.string().max(ICP_NOTE_MAX),
          })
          .strict(),
      )
      .max(ICP_CRITERIA_MAX),
    reasons: z.array(z.string().max(ICP_REASON_MAX)).max(ICP_REASONS_MAX),
    evidenceRefs: z.array(icpEvidenceRefSchema).max(ICP_EVIDENCE_REFS_MAX),
    /** Dirty gate (spec §5) — recompute iff this changes. NEVER age-based. */
    inputSig: z.string(),
    /** The `IcpDefinition.version` this verdict was scored against. */
    icpVersion: z.number().int().min(1),
    model: z.string(),
    promptVersion: z.number().int().min(1),
    scoredAt: z.iso.datetime(),
  })
  .strict()
  // `score` and `band` are independently-bounded fields above, but §4 makes them
  // ONE verdict (see icpVerdict): `disqualified` only ever comes with a clamped
  // score, and every other band is exactly the score's own ramp bucket. Without
  // this refinement a malformed judge response — e.g. `{score:90,band:'disqualified'}`
  // — would parse as a valid stored result instead of being rejected for retry/skip.
  .refine(
    (r) =>
      r.band === 'disqualified'
        ? r.score <= ICP_DISQUALIFIED_SCORE_MAX
        : r.band === icpBandForScore(r.score),
    { message: 'score and band must agree (see icpVerdict)', path: ['band'] },
  );
export type IcpResult = z.infer<typeof icpResultSchema>;

/**
 * TODO(handoff): nothing WRITES `_icp` yet — S3 (judge + dirty gate) and S4
 * (tick + refresh endpoints) of 2026-08-03-crm-icp-score-spec do, and they must
 * go through the shared atomic `setContactCustomField` primitive in
 * `crm-contacts.service.ts` (a second per-key setter, or a read-modify-write
 * like `_funnel`'s old one, is what §6.1 exists to forbid). The roster already
 * PROJECTS `custom_fields->'_icp'->>'score'`, so until then every contact reads
 * as unscored — the spec's default-off state.
 */

/** Safe-parse a raw `_icp` value (e.g. read straight off the jsonb column);
 *  invalid/absent → undefined. Mirrors `parseRelationshipValue`. */
export function parseIcpResult(raw: unknown): IcpResult | undefined {
  if (raw == null) return undefined;
  const parsed = icpResultSchema.safeParse(raw);
  return parsed.success ? parsed.data : undefined;
}

/** Read the stored verdict from a contact's custom_fields (if valid). */
export function readIcpResult(
  customFields: Record<string, unknown> | null | undefined,
): IcpResult | undefined {
  return parseIcpResult(customFields?.[ICP_KEY]);
}

// ── Masking (spec §7) ───────────────────────────────────────────────────────

/** The fields a field-level-masked principal may see: derived aggregates and
 *  bookkeeping. Deliberately a WHITELIST — `pii.ts` masking is shallow, and a
 *  blacklist would silently start leaking the day someone adds a field to
 *  `IcpResult`. */
export interface MaskedIcpResult {
  score?: number;
  band?: IcpBand;
  criteria?: Array<{ id: string; met: boolean }>;
  inputSig?: string;
  icpVersion?: number;
  model?: string;
  promptVersion?: number;
  scoredAt?: string;
}

function isBand(v: unknown): v is IcpBand {
  return typeof v === 'string' && (ICP_BANDS as readonly string[]).includes(v);
}

/**
 * Strip the LLM-written free text from an `_icp` blob for a masked principal:
 * `reasons`, `criteria[].note` and `evidenceRefs` are summaries of (and
 * pointers into) private conversations.
 *
 * `score` and `band` are KEPT — they are derived aggregates of exactly the same
 * class as the RFM `score`, which a masked principal already sees; hiding them
 * would blank a column rather than protect anything. (Spec §7 flags this as the
 * decision point: the stricter alternative is to drop `_icp` wholesale as
 * `_relationship` does. If that ruling changes, change it HERE — this is the
 * only implementation.)
 *
 * Operates on `unknown` because the value comes off a jsonb column that no
 * schema guards at rest: anything that is not a plain object is dropped
 * entirely (returns `undefined`), and every whitelisted field is copied only
 * when it has the expected primitive type, so free text stuffed into `score`
 * cannot ride through.
 */
export function maskIcpResult(raw: unknown): MaskedIcpResult | undefined {
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const src = raw as Record<string, unknown>;
  const out: MaskedIcpResult = {};
  if (typeof src.score === 'number' && Number.isFinite(src.score)) out.score = src.score;
  if (isBand(src.band)) out.band = src.band;
  if (Array.isArray(src.criteria)) {
    out.criteria = src.criteria.flatMap((c) => {
      if (c == null || typeof c !== 'object' || Array.isArray(c)) return [];
      const entry = c as Record<string, unknown>;
      if (typeof entry.id !== 'string' || typeof entry.met !== 'boolean') return [];
      return [{ id: entry.id, met: entry.met }];
    });
  }
  if (typeof src.inputSig === 'string') out.inputSig = src.inputSig;
  if (typeof src.icpVersion === 'number' && Number.isFinite(src.icpVersion))
    out.icpVersion = src.icpVersion;
  if (typeof src.model === 'string') out.model = src.model;
  if (typeof src.promptVersion === 'number' && Number.isFinite(src.promptVersion))
    out.promptVersion = src.promptVersion;
  if (typeof src.scoredAt === 'string') out.scoredAt = src.scoredAt;
  return out;
}
