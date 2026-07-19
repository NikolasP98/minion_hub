import type { PageServerLoad } from './$types';
import { requireAdmin } from '$server/auth/authorize';
import { listAllOrganizationsWithMemberCounts } from '$server/services/organizations.service';

export const load: PageServerLoad = async ({ locals, depends }) => {
  requireAdmin(locals);
  depends('settings:organizations');
  return { organizations: await listAllOrganizationsWithMemberCounts() };
};
