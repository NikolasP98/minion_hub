import type { PageServerLoad } from './$types';
import { error } from '@sveltejs/kit';
import { getCoreCtx } from '$server/auth/core-ctx';
import { isModuleEnabled } from '$server/services/modules.service';
import { listConnections, listAssetsWithStatus, syncJobHistory } from '$server/services/meta/meta-insights.service';

export const load: PageServerLoad = async ({ locals, depends }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401, 'Authentication required');
  if (!(await isModuleEnabled(ctx, 'ads'))) throw error(404, 'Ads module disabled');
  depends('ads:settings');

  const [connections, assets, jobs] = await Promise.all([
    listConnections(ctx),
    listAssetsWithStatus(ctx),
    syncJobHistory(ctx, { limit: 20 }),
  ]);

  return { connections, assets, jobs };
};
