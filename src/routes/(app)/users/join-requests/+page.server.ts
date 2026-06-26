import type { PageServerLoad } from './$types';
import { error } from '@sveltejs/kit';
import { requireOrgCapability } from '$server/services/rbac.service';
import { listPendingRequests } from '$server/services/join/requests.service';
import { listLinks } from '$server/services/join/links.service';
import { listAllOrganizations } from '$server/services/organizations.service';

export const load: PageServerLoad = async ({ locals }) => {
  await requireOrgCapability(locals, 'users', 'manage');
  if (!locals.tenantCtx) throw error(401, 'tenant context required');
  // Supabase organizations (Turso fallback during bake).
  const orgs = await listAllOrganizations();
  return {
    // Org-scoped: an admin only sees their own org's pending requests.
    requests: await listPendingRequests(locals.tenantCtx.tenantId),
    links: await listLinks(),
    orgs,
  };
};
