import type { PageServerLoad } from './$types';
import { requireOrgCapability } from '$server/services/rbac.service';

export const load: PageServerLoad = async ({ locals }) => {
  await requireOrgCapability(locals, 'workspace', 'manage');
  return {};
};
