import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { z } from 'zod';
import { getCoreCtx } from '$server/auth/core-ctx';
import { parseBody } from '$server/api/validate';
import { ownerFilter, shouldMaskSensitive } from '$server/services/rbac.service';
import { setUserRelationship, resumeAiSuggestions } from '$server/services/crm-relationship.service';
import { RELATIONSHIP_CATEGORIES } from '$lib/components/crm/crm-relationship';

// The relationship graph is manually editable in BOTH org kinds (spec v2 R7 —
// only the future AI inference tick, WP2/3, is personal-only). No org-kind
// gate here, unlike the marketing-funnel endpoint. Write-capability (crm:edit
// / crm:delete) is gated centrally by `apiWriteCapability` (hooks.server.ts,
// `/api/crm` prefix) — no per-route requireOrgCapability call needed.
//
// Record-level (if-owner) + field-level scope (spec F2): the central hook
// only checks the coarse `crm:edit`/`crm:delete` capability, not per-record
// ownership or PII masking — both resolved here, same as the contact detail
// GET route. A masked principal may never write/see relationship data (it's
// PII-adjacent, spec R6); an owner-scoped principal may only touch a contact
// they own — folded into the service's atomic WHERE, not a prior read.

const putSchema = z.object({
  label: z.string().nullable(),
  category: z.enum(RELATIONSHIP_CATEGORIES),
});

/**
 * PUT /api/crm/contacts/[id]/relationship { label, category }
 *   → manual override; pins the relationship (source:'user'). AI inference
 *     must never overwrite it while pinned.
 */
export const PUT: RequestHandler = async ({ locals, params, request }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  const [ownerId, maskSensitive] = await Promise.all([
    ownerFilter(locals, 'crm'),
    shouldMaskSensitive(locals, 'crm'),
  ]);
  if (maskSensitive) throw error(403);
  const data = await parseBody(request, putSchema);
  const result = await setUserRelationship(ctx, params.id!, data, ownerId);
  if (!result.applied) throw error(404, 'Contact not found');
  return json(result);
};

/**
 * DELETE /api/crm/contacts/[id]/relationship
 *   → "Resume AI suggestions": clears the user pin so a future inference run
 *     may populate the relationship again.
 */
export const DELETE: RequestHandler = async ({ locals, params }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  const [ownerId, maskSensitive] = await Promise.all([
    ownerFilter(locals, 'crm'),
    shouldMaskSensitive(locals, 'crm'),
  ]);
  if (maskSensitive) throw error(403);
  const result = await resumeAiSuggestions(ctx, params.id!, ownerId);
  if (!result.applied) throw error(404, 'Contact not found');
  return json(result);
};
