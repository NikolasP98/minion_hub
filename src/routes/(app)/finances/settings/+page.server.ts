import type { PageServerLoad } from './$types';
import { error } from '@sveltejs/kit';
import { getCoreCtx } from '$server/auth/core-ctx';
import { isModuleEnabled, listModuleStates } from '$server/services/modules.service';
import { getSource } from '$server/services/finance.service';

export const load: PageServerLoad = async ({ locals }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401, 'Authentication required');
  if (!(await isModuleEnabled(ctx, 'finances'))) throw error(404, 'Finances module disabled');
  const [source, modules] = await Promise.all([
    getSource(ctx, 'susii'),
    listModuleStates(ctx),
  ]);
  return { source, modules };
};
