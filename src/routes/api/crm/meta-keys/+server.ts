import type { RequestHandler } from '@sveltejs/kit';
import { error, json } from '@sveltejs/kit';
import { getCoreCtx } from '$server/auth/core-ctx';
import { getMetaKeys } from '$server/services/crm-contacts.service';
import { requireOrgCapability } from '$server/services/rbac.service';

/** Org-wide user-defined CRM fields for create forms. */
export const GET: RequestHandler = async ({ locals }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  await requireOrgCapability(locals, 'crm', 'view');
  return json({ keys: await getMetaKeys(ctx) });
};
