/**
 * Real relationships (spec v2 §R2) — pure helpers (no I/O, no paraglide), same
 * split as crm-funnel.ts: shared by server (crm-relationship.service.ts) and
 * client (graph popover) and unit-testable without SvelteKit aliases.
 *
 * The persisted blob lives on `crm_contacts.custom_fields._relationship` (a
 * reserved, display-hidden key — already excluded by `isReservedMetaKey`'s
 * `_`-prefix rule, same as `_funnel`). `category` is the machine axis (drives
 * graph edge color); `label` is the human axis (free text — "amiga del
 * trabajo"). `source: 'user'` IS the pin — AI must never overwrite it; there is
 * no separate override flag (v1 had one, v2 dropped it — see spec R2).
 */
import { z } from 'zod';

/** Code/Zod enum only — never store an arbitrary string as `category`. */
export const RELATIONSHIP_CATEGORIES = [
  'family',
  'romantic_partner',
  'friend',
  'work',
  'acquaintance',
  'service',
  'other',
  'unknown',
] as const;
export type RelationshipCategory = (typeof RELATIONSHIP_CATEGORIES)[number];

export function isRelationshipCategory(v: unknown): v is RelationshipCategory {
  return typeof v === 'string' && (RELATIONSHIP_CATEGORIES as readonly string[]).includes(v);
}

const evidenceRefSchema = z.object({
  chunkId: z.string(),
  occurredAt: z.string().optional(),
});

export const relationshipSchema = z.object({
  /** null + source:'user' = the user explicitly cleared it — AI must not refill. */
  label: z.string().nullable(),
  category: z.enum(RELATIONSHIP_CATEGORIES),
  source: z.enum(['ai', 'user']),
  /** AI only; a user edit never fabricates a confidence value. */
  confidence: z.number().min(0).max(1).optional(),
  /** Aggregated content_sig of the contact's conversations (WP3 dirty gate). */
  inputSig: z.string().optional(),
  inferenceVersion: z.number().optional(),
  model: z.string().optional(),
  updatedAt: z.string(),
  /** Opaque refs, never raw quotes (spec R6 — masking/PII). */
  evidenceRefs: z.array(evidenceRefSchema).optional(),
});
export type Relationship = z.infer<typeof relationshipSchema>;

/** Safe-parse a raw `_relationship` value (e.g. a `custom_fields->'_relationship'`
 *  jsonb column read directly); invalid/absent → undefined. */
export function parseRelationshipValue(raw: unknown): Relationship | undefined {
  if (raw == null) return undefined;
  const parsed = relationshipSchema.safeParse(raw);
  return parsed.success ? parsed.data : undefined;
}

/** Read the stored relationship blob from a contact's custom_fields (if valid). */
export function readRelationship(
  customFields: Record<string, unknown> | null | undefined,
): Relationship | undefined {
  return parseRelationshipValue(customFields?.['_relationship']);
}
