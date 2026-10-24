import type { PageServerLoad } from './$types';
import { datasetCtx, isDenied } from '$server/auth/dataset-ctx';
import {
  listConnections,
  listAssetsWithStatus,
  syncJobHistory,
} from '$server/services/meta/meta-insights.service';

export const load: PageServerLoad = async ({ locals, depends }) => {
  const ctx = await datasetCtx(locals, 'ads');
  if (isDenied(ctx)) return { ads: ctx }; // rendered by DataSource (spec 039)
  depends('ads:settings');

  const [connections, assets, jobs] = await Promise.all([
    listConnections(ctx),
    listAssetsWithStatus(ctx),
    syncJobHistory(ctx, { limit: 20 }),
  ]);

  return { ads: { connections, assets, jobs } };
};
