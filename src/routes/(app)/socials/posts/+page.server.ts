import type { PageServerLoad } from './$types';
import { datasetCtx, isDenied } from '$server/auth/dataset-ctx';
import { postPerformance, listConnections } from '$server/services/meta/meta-insights.service';

export const load: PageServerLoad = async ({ locals, depends }) => {
  const ctx = await datasetCtx(locals, 'ads');
  if (isDenied(ctx)) return { ads: ctx }; // rendered by DataSource (spec 039)
  depends('ads:data');

  const connections = await listConnections(ctx);
  const hasConnection = connections.some((c) => c.status !== 'revoked');
  // Platform/type filtering lives in the DataTable's column-header filter menus
  // (client-side, over these 200 most-recent posts) — not a server-side param.
  const posts = hasConnection ? await postPerformance(ctx, { limit: 200, orderBy: 'recent' }) : [];
  return { ads: { hasConnection, posts } };
};
