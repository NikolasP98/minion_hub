import type { PageServerLoad } from './$types';
import { error } from '@sveltejs/kit';
import { requireAdmin } from '$server/auth/authorize';
import { getCoreCtx } from '$server/auth/core-ctx';
import { listModuleStates } from '$server/services/modules.service';

export const load: PageServerLoad = async ({ locals }) => {
  requireAdmin(locals);
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401, 'tenant context required');
  const modules = await listModuleStates(ctx);
  return { modules };
};
