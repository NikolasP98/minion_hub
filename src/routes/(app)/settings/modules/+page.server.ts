import type { PageServerLoad } from './$types';
import { requireDataset } from '$server/auth/dataset-ctx';
import { requireOrgCapability } from '$server/services/rbac.service';
import { listModuleStates } from '$server/services/modules.service';

export const load: PageServerLoad = async ({ locals }) => {
  await requireOrgCapability(locals, 'settings', 'manage');
  const ctx = await requireDataset(locals, 'settings');
  const modules = await listModuleStates(ctx);
  return { modules };
};
