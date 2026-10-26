import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { z } from 'zod';
import { getCoreCtx } from '$server/auth/core-ctx';
import { ownerFilter, requireOrgCapability } from '$server/services/rbac.service';
import { getContact } from '$server/services/crm-contacts.service';
import { isModuleEnabled } from '$server/services/modules.service';
import { getNextOffers } from '$server/services/crm-next-offers.service';

/** GET /api/crm/contacts/[id]/next-offers → what the contact bought + what to offer next. */
export const GET: RequestHandler = async ({ locals, params }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401, 'Authentication required');
  await requireOrgCapability(locals, 'crm', 'view');
  const id = z.string().uuid().safeParse(params.id);
  if (!id.success) throw error(404);
  const ownerId = await ownerFilter(locals, 'crm');
  // Another rep's contact is indistinguishable from a missing one.
  if (!(await getContact(ctx, id.data, ownerId))) throw error(404);
  if (!(await isModuleEnabled(ctx, 'pos'))) {
    return json({ bought: [], suggestions: [], topSellers: [] });
  }
  return json(await getNextOffers(ctx, id.data));
};
