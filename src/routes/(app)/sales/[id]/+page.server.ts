import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getCoreCtx } from '$server/auth/core-ctx';
import { ownerFilter } from '$server/services/rbac.service';
import { isModuleEnabled } from '$server/services/modules.service';
import { getOrder } from '$server/services/sales.service';
import { listEntityTimeline } from '$server/services/activity.service';
import { transitionsFor } from '$server/services/workflow.service';

export const load: PageServerLoad = async ({ locals, params, depends }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401, 'Authentication required');
  if (!(await isModuleEnabled(ctx, 'sales'))) throw error(404, 'Sales module disabled');
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
  return { order, timeline, transitions };
};
