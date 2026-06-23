import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { getCoreCtx } from '$server/auth/core-ctx';
import { getContactPrefill } from '$server/services/crm-contacts.service';

/** GET /api/crm/contacts/:id/prefill — fetch_from source (name/phone/email) used
 *  to auto-fill a form when a contact is picked. */
export const GET: RequestHandler = async ({ locals, params }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  const data = await getContactPrefill(ctx, params.id!);
  if (!data) throw error(404);
  return json(data);
};
