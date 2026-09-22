import type { PageServerLoad } from './$types';
import { requireOrgCapability } from '$server/services/rbac.service';

/** The table-config document itself rides on the app layout (`tableConfig`). */
export const load: PageServerLoad = async ({ locals, depends }) => {
  depends('settings:tables');
  await requireOrgCapability(locals, 'settings', 'manage');
  return {};
};
