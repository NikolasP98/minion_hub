/**
 * CRM ICP score — the contract (spec 2026-08-03-crm-icp-score-spec §3).
 *
 * Single home of every ICP key name, cap and shape. Pure: imports `zod` only,
 * so server code and browser code can share it. Nothing else may restate a
 * cap or a key string.
 *
 * Two different things share the "icp" name — do not confuse them:
 *  - `crm_settings.value.icp` is the per-ORG definition (`IcpDefinition`):
 *    what an ideal customer looks like. Written through the settings path.
 *  - `crm_contacts.custom_fields._icp` (`ICP_KEY`) is the per-CONTACT result
 *    (`IcpResult`): how one contact scored. It is written only via
 *    `setContactCustomField` (Slices 3/4), never from a client payload.
 *
 * Masking (spec §7): for a masked principal the default ruling keeps score and
 * band and strips everything else (`maskIcpResult`). The stricter fallback —
 * strip `_icp` entirely — is a reviewer decision per spec §7; if taken, the
 * caller simply deletes the key instead of calling `maskIcpResult`.
 */
import { z } from 'zod';

/** `crm_contacts.custom_fields` key holding the per-contact `IcpResult`. */
export const ICP_KEY = '_icp' as const;
/** Internal inference lease key. Never serialised to clients. */
export const ICP_CLAIM_KEY = '_icpClaim' as const;

// ── Caps (spec §3; the ones marked * are this module's own choice) ──────────
export const ICP_DESCRIPTION_MAX = 2000;
export const ICP_CRITERIA_MAX = 8;
export const ICP_CRITERION_ID_MAX = 40; // *
export const ICP_CRITERION_ID_RE = /^[a-z0-9][a-z0-9_-]*$/; // *
export const ICP_CRITERION_LABEL_MAX = 200; // *
export const ICP_WEIGHT_MIN = 1;
export const ICP_WEIGHT_MAX = 5;
export const ICP_DISQUALIFIERS_MAX = 5;
export const ICP_DISQUALIFIER_MAX = 200; // *
export const ICP_NOTE_MAX = 140;
export const ICP_REASONS_MAX = 3;
export const ICP_REASON_MAX = 200;
export const ICP_EVIDENCE_REFS_MAX = 10; // *
export const ICP_SCORE_MIN = 0;
export const ICP_SCORE_MAX = 100;
export const ICP_DISQUALIFIED_SCORE_MAX = 10;

export const ICP_BANDS = ['strong', 'moderate', 'weak', 'disqualified'] as const;
export type IcpBand = (typeof ICP_BANDS)[number];

// ── Definition (per org) ────────────────────────────────────────────────────

const criterionSchema = z.strictObject({
	id: z.string().max(ICP_CRITERION_ID_MAX).regex(ICP_CRITERION_ID_RE),
	label: z.string().trim().min(1).max(ICP_CRITERION_LABEL_MAX),
	weight: z.number().int().min(ICP_WEIGHT_MIN).max(ICP_WEIGHT_MAX),
});

/**
 * WRITE boundary — STRICT. Unknown keys are rejected and over-cap input is
 * rejected rather than truncated. `version` and `updatedAt` are server-owned:
 * sending either is a validation error.
 */
export const icpDefinitionWriteSchema = z.strictObject({
	description: z.string().trim().max(ICP_DESCRIPTION_MAX),
	criteria: z
		.array(criterionSchema)
		.max(ICP_CRITERIA_MAX)
		.refine((list) => new Set(list.map((c) => c.id)).size === list.length, {
			message: 'criterion ids must be unique',
		}),
	disqualifiers: z
		.array(z.string().trim().min(1).max(ICP_DISQUALIFIER_MAX))
		.max(ICP_DISQUALIFIERS_MAX),
});
export type IcpDefinitionInput = z.infer<typeof icpDefinitionWriteSchema>;

/** Stored shape of `crm_settings.value.icp`: the write shape plus server-owned fields. */
export const icpDefinitionSchema = icpDefinitionWriteSchema.extend({
	version: z.number().int().positive(),
	updatedAt: z.iso.datetime({ offset: true }),
});
export type IcpDefinition = z.infer<typeof icpDefinitionSchema>;

/** Missing or empty definition ⇒ the feature is off (spec §3.1). */
export function isIcpConfigured(def: IcpDefinition | null | undefined): def is IcpDefinition {
	return !!def && (def.criteria.length > 0 || def.description.trim() !== '');
}

// ── Result (per contact) ────────────────────────────────────────────────────

/** Refs only: an `evidenceRefs` entry never carries chunk text. */
const evidenceRefSchema = z.strictObject({ chunkId: z.string().min(1) });

const criterionResultSchema = z.strictObject({
	id: z.string().max(ICP_CRITERION_ID_MAX).regex(ICP_CRITERION_ID_RE),
	met: z.boolean(),
	note: z.string().max(ICP_NOTE_MAX),
});

export const icpResultSchema = z
	.strictObject({
		score: z.number().min(ICP_SCORE_MIN).max(ICP_SCORE_MAX),
		band: z.enum(ICP_BANDS),
		criteria: z.array(criterionResultSchema).max(ICP_CRITERIA_MAX),
		reasons: z.array(z.string().max(ICP_REASON_MAX)).max(ICP_REASONS_MAX),
		evidenceRefs: z.array(evidenceRefSchema).max(ICP_EVIDENCE_REFS_MAX),
		inputSig: z.string().min(1),
		icpVersion: z.number().int().positive(),
		model: z.string().min(1),
		promptVersion: z.number().int().positive(),
		scoredAt: z.iso.datetime({ offset: true }),
	})
	.refine((r) => r.band !== 'disqualified' || r.score <= ICP_DISQUALIFIED_SCORE_MAX, {
		message: `a disqualified result must score at most ${ICP_DISQUALIFIED_SCORE_MAX}`,
		path: ['score'],
	});
export type IcpResult = z.infer<typeof icpResultSchema>;

export function parseIcpResult(raw: unknown): IcpResult | undefined {
	const parsed = icpResultSchema.safeParse(raw);
	return parsed.success ? parsed.data : undefined;
}

export interface MaskedIcpResult {
	score: number;
	band: IcpBand;
	criteria: Array<{ id: string; met: boolean }>;
	icpVersion: number;
	scoredAt: string;
}

/**
 * Whitelist projection for a masked principal (spec §7 default ruling): keeps
 * score, band, criteria[].{id,met}, icpVersion and scoredAt; drops reasons,
 * criteria[].note, evidenceRefs, inputSig, model and promptVersion. Input that
 * fails `icpResultSchema` yields `undefined` — fail closed, the caller deletes
 * the key. The input is never mutated.
 */
export function maskIcpResult(raw: unknown): MaskedIcpResult | undefined {
	const r = parseIcpResult(raw);
	if (!r) return undefined;
	return {
		score: r.score,
		band: r.band,
		criteria: r.criteria.map((c) => ({ id: c.id, met: c.met })),
		icpVersion: r.icpVersion,
		scoredAt: r.scoredAt,
	};
}
