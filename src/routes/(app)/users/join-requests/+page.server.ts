import type { PageServerLoad } from './$types';
import { error } from '@sveltejs/kit';
import { requireOrgCapability } from '$server/services/rbac.service';
import { listPendingRequests } from '$server/services/join/requests.service';
import { listLinks } from '$server/services/join/links.service';

export const load: PageServerLoad = async ({ locals, parent }) => {
  await requireOrgCapability(locals, 'users', 'manage');
  if (!locals.tenantCtx) throw error(401, 'tenant context required');

  // This page is org-capability-gated (not role:admin) — any org owner/manager
  // with users:manage can reach it, not only platform admins — so the join-link
  // org picker must offer only the caller's own active org, not every org in
  // the system (D4: `listAllOrganizations()` used to feed this picker).
  const { organizations, activeOrgId } = await parent();
  const activeOrg = organizations.find((o) => o.id === activeOrgId);
  const orgs = activeOrg
    ? [{ id: activeOrg.id, name: activeOrg.name, slug: activeOrg.slug ?? null }]
    : [];

  return {
    // Org-scoped: an admin only sees their own org's pending requests / links.
    requests: await listPendingRequests(locals.tenantCtx.tenantId),
    links: await listLinks(locals.tenantCtx.tenantId),
    orgs,
  };
};
