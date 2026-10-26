import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { z } from 'zod';
import { getCoreCtx } from '$server/auth/core-ctx';
import { parseBody } from '$server/api/validate';
import { withOrgCore } from '$server/db/with-org-core';
import { ownerFilter } from '$server/services/rbac.service';
import { getContact, setContactCustomField } from '$server/services/crm-contacts.service';

const bodySchema = z.object({ optOut: z.boolean() });

/**
 * PUT /api/crm/contacts/[id]/reminders-opt-out { optOut }
 *   → writes the reserved `_reminders_opt_out` custom field (PATCH strips `_` keys by design).
 * crm:edit is enforced by the central write guard in hooks.server.ts (403 JSON).
 */
export const PUT: RequestHandler = async ({ locals, params, request }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  const ownerId = await ownerFilter(locals, 'crm');
  if (ownerId && !(await getContact(ctx, params.id!, ownerId, true)))
    throw error(404, 'Contact not found');
  const { optOut } = await parseBody(request, bodySchema);
  const ok = await withOrgCore(ctx, (tx) =>
    setContactCustomField(tx, ctx.tenantId, params.id!, '_reminders_opt_out', optOut),
  );
  if (!ok) throw error(404, 'Contact not found');
  return json({ ok: true, optOut });
};
