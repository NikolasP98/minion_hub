import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { getCoreCtx } from '$server/auth/core-ctx';
import { searchRecords } from '$server/services/search.service';
import { hasOrgCapability, ownerFilter } from '$server/services/rbac.service';

/** GET /api/search?q= — global record search for the command palette. */
export const GET: RequestHandler = async ({ locals, url }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  const [crmAllowed, supportAllowed, salesAllowed] = await Promise.all([
    hasOrgCapability(locals, 'crm', 'view'),
    hasOrgCapability(locals, 'support', 'view'),
    hasOrgCapability(locals, 'sales', 'view'),
  ]);
  const [crmOwner, supportOwner, salesOwner] = await Promise.all([
    crmAllowed ? ownerFilter(locals, 'crm') : undefined,
    supportAllowed ? ownerFilter(locals, 'support') : undefined,
    salesAllowed ? ownerFilter(locals, 'sales') : undefined,
  ]);
  const hits = await searchRecords(ctx, url.searchParams.get('q') ?? '', {
    crm: { allowed: crmAllowed, ownerId: crmOwner },
    support: { allowed: supportAllowed, ownerId: supportOwner },
    sales: { allowed: salesAllowed, ownerId: salesOwner },
  });
  return json({ hits });
};
