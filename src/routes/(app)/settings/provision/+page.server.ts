import type { PageServerLoad } from './$types';
import { requireOrgCapability } from '$server/services/rbac.service';

// Server-provisioning config is org-admin only. The page was previously
// client-only (no server guard) — gate it on settings:manage like the other
// org-config subpages.
export const load: PageServerLoad = async ({ locals }) => {
  await requireOrgCapability(locals, 'settings', 'manage');
  return {};
};
