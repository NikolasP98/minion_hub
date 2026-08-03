import type { PageServerLoad } from './$types';
import { error } from '@sveltejs/kit';
import { getCoreCtx } from '$server/auth/core-ctx';
import { getSource, sourceHasCredentials, getFinSettings } from '$server/services/finance.service';

export const load: PageServerLoad = async ({ locals }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401, 'Authentication required');
  const [src, settings] = await Promise.all([getSource(ctx, 'susii'), getFinSettings(ctx)]);
  return {
    source: src ? { ...src, secretRefs: undefined, hasCredentials: sourceHasCredentials(src) } : null,
    settings,
  };
};
