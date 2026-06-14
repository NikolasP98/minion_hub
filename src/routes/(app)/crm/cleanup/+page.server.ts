import type { PageServerLoad } from './$types';
import { error } from '@sveltejs/kit';
import { getCoreCtx } from '$server/auth/core-ctx';
import { scanStandardization, findDuplicates } from '$server/services/crm-cleanup.service';

export const load: PageServerLoad = async ({ locals, depends }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401, 'Authentication required');
  depends('crm:cleanup');
  const [fixes, groups] = await Promise.all([scanStandardization(ctx), findDuplicates(ctx)]);
  return { fixes, groups };
};
