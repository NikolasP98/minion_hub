import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { z } from 'zod';
import { getCoreCtx } from '$server/auth/core-ctx';
import { parseBody } from '$server/api/validate';
import { scanStandardization, applyStandardization } from '$server/services/crm-cleanup.service';

// TODO(handoff): no ownerFilter on this scan/apply pair, unlike the sibling
// GET /api/crm/cleanup/duplicates. scanStandardization/applyStandardization
// take no ownerId and operate org-wide by contactId — an owner-scoped role
// currently sees (GET) and can rename (POST) contacts they don't own. Fixing
// this needs ownerId support added to both service functions (a service
// change out of this slice's scope; spec 2026-09-12-erp-core-modules-
// attachments, S11 B3 audit).

/** GET /api/crm/cleanup/standardize — deterministic name-fix proposals. */
export const GET: RequestHandler = async ({ locals }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  return json({ fixes: await scanStandardization(ctx) });
};

const postSchema = z.object({
  fixes: z
    .array(
      z.object({
        contactId: z.string().min(1).max(200),
        name: z.string().max(500),
        before: z.string().max(500).nullable().optional(),
      }),
    )
    .optional()
    .default([]),
});

/** POST /api/crm/cleanup/standardize { fixes: [{contactId, name, before?}] } — apply. */
export const POST: RequestHandler = async ({ locals, request }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  const body = await parseBody(request, postSchema);
  const valid = body.fixes.map((f) => ({
    contactId: f.contactId,
    name: f.name,
    before: f.before ?? null,
  }));
  return json({ updated: await applyStandardization(ctx, valid) });
};
