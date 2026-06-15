import type { PageServerLoad } from './$types';
import { error } from '@sveltejs/kit';
import { getCoreCtx } from '$server/auth/core-ctx';
import {
  scanStandardizationCached,
  findDuplicatesCached,
} from '$server/services/crm-cleanup.service';

export const load: PageServerLoad = async ({ locals, depends }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401, 'Authentication required');
  depends('crm:cleanup');
  const [fixes, groups] = await Promise.all([
    scanStandardizationCached(ctx),
    findDuplicatesCached(ctx),
  ]);
  return { fixes, groups };
};
