import type { PageServerLoad } from './$types';
import { error } from '@sveltejs/kit';
import { getCoreCtx } from '$server/auth/core-ctx';
import { isModuleEnabled } from '$server/services/modules.service';
import { postPerformance, listConnections } from '$server/services/meta/meta-insights.service';

export const load: PageServerLoad = async ({ locals, depends }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401, 'Authentication required');
  if (!(await isModuleEnabled(ctx, 'ads'))) throw error(404, 'Ads module disabled');
  depends('ads:data');

  const connections = await listConnections(ctx);
  const hasConnection = connections.some((c) => c.status !== 'revoked');
  // Platform/type filtering lives in the DataTable's column-header filter menus
  // (client-side, over these 200 most-recent posts) — not a server-side param.
  const posts = hasConnection ? await postPerformance(ctx, { limit: 200, orderBy: 'recent' }) : [];
  return { hasConnection, posts };
};
