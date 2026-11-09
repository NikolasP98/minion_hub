import { ownerFilter, shouldMaskSensitive } from '$server/services/rbac.service';
import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { getCoreCtx } from '$server/auth/core-ctx';
import { getContactPrefill } from '$server/services/crm-contacts.service';

/** GET /api/crm/contacts/:id/prefill — fetch_from source (name/phone/email) used
 *  to auto-fill a form when a contact is picked. */
export const GET: RequestHandler = async ({ locals, params }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  const [ownerId, maskSensitive] = await Promise.all([
    ownerFilter(locals, 'crm'),
    shouldMaskSensitive(locals, 'crm'),
  ]);
  const data = await getContactPrefill(ctx, params.id!, ownerId, maskSensitive);
  if (!data) throw error(404);
  return json(data);
};
