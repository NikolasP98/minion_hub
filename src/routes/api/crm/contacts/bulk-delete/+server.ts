import type { RequestHandler } from '@sveltejs/kit';
import { error, json } from '@sveltejs/kit';
import { z } from 'zod';
import { getCoreCtx } from '$server/auth/core-ctx';
import { parseBody } from '$server/api/validate';
import { requireOrgCapability, ownerFilter } from '$server/services/rbac.service';
import { ROSTER_CAP, softDeleteContacts } from '$server/services/crm-contacts.service';

const schema = z.object({ ids: z.array(z.string().uuid()).min(1).max(ROSTER_CAP) });

export const POST: RequestHandler = async ({ locals, request }) => {
  await requireOrgCapability(locals, 'crm', 'delete');
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  const body = await parseBody(request, schema);
  // Record-level (if-owner) scope: same pattern as the contact detail loader
  // — a scoped caller's bulk-delete silently drops ids they don't own instead
  // of deleting across the whole roster.
  const ownerId = await ownerFilter(locals, 'crm');
  const deleted = await softDeleteContacts(ctx, body.ids, ownerId);
  return json({ ok: true, deleted });
};
