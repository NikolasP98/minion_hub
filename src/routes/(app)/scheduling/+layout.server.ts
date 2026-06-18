import { error } from '@sveltejs/kit';
import type { LayoutServerLoad } from './$types';
import { getCoreCtx } from '$server/auth/core-ctx';
import { isModuleEnabled } from '$server/services/modules.service';

/** Gate the whole /scheduling subtree on the per-org module toggle. */
export const load: LayoutServerLoad = async ({ locals }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401, 'Authentication required');
  if (!(await isModuleEnabled(ctx, 'scheduling'))) throw error(404, 'Scheduling module disabled');
  return {};
};
