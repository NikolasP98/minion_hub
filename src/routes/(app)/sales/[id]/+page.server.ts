import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { datasetCtx, isDenied } from '$server/auth/dataset-ctx';
import { ownerFilter } from '$server/services/rbac.service';
import { getOrder } from '$server/services/sales.service';
import { listEntityTimeline } from '$server/services/activity.service';
import { transitionsFor } from '$server/services/workflow.service';
import { uuidParamOr404 } from '$server/utils/uuid-param';

export const load: PageServerLoad = async ({ locals, params, depends }) => {
  uuidParamOr404(params.id);
  const ctx = await datasetCtx(locals, 'sales');
  if (isDenied(ctx)) return { sales: ctx }; // rendered by DataSource (spec 039)
  depends('sales:order');

  // if-owner scope: a scoped caller only opens orders they own (else 404).
  const order = await getOrder(ctx, params.id, await ownerFilter(locals, 'sales'));
  if (!order) throw error(404, 'Order not found');
  const [timeline, transitions] = await Promise.all([
    listEntityTimeline(ctx, 'sales_order', params.id),
    transitionsFor(ctx, 'sales_order', params.id, {
      id: locals.user?.supabaseId ?? null,
      name: locals.user?.displayName ?? locals.user?.email ?? null,
      role: locals.user?.role ?? null,
    }),
  ]);
  return { sales: { order, timeline, transitions } };
};
