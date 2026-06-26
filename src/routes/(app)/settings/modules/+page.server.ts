import type { PageServerLoad } from './$types';
import { error } from '@sveltejs/kit';
import { getCoreCtx } from '$server/auth/core-ctx';
import { requireOrgCapability } from '$server/services/rbac.service';
import { listModuleStates } from '$server/services/modules.service';

export const load: PageServerLoad = async ({ locals }) => {
  await requireOrgCapability(locals, 'settings', 'manage');
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401, 'tenant context required');
  const modules = await listModuleStates(ctx);
  return { modules };
};
