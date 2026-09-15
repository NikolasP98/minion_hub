import type { PageServerLoad } from './$types';
import { error } from '@sveltejs/kit';
import { getCoreCtx } from '$server/auth/core-ctx';
import { listSellables, listTickets, listShifts } from '$server/services/pos.service';
import { listResources, listEventTypes } from '$server/services/scheduling.service';

/** View perm (`pos.sell:view`) is enforced centrally by the root layout guard
 *  (MODULE_SUBRESOURCES) — this load only fetches the tab's data.
 *
 *  Event types + resources feed the `?step=schedule` third step (the same two
 *  reads `/pos/appointments/new` does). Skipped entirely when the scheduling
 *  module is off: that step then never renders, so fetching for it is waste. */
export const load: PageServerLoad = async ({ locals, depends }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401, 'Authentication required');
  depends('pos:sell');

  const schedulingEnabled = locals.moduleStates?.scheduling ?? true;
  const [sellables, recentTickets, shifts, resources, eventTypes] = await Promise.all([
    listSellables(ctx),
    listTickets(ctx, { limit: 10 }),
    listShifts(ctx, { limit: 10 }),
    schedulingEnabled ? listResources(ctx) : Promise.resolve([]),
    schedulingEnabled ? listEventTypes(ctx) : Promise.resolve([]),
  ]);

  return {
    sellables,
    recentTickets,
    shifts,
    schedulingEnabled,
    stockEnabled: locals.moduleStates?.stock ?? true,
    resources: resources.filter((r) => r.active).map((r) => ({ id: r.id, name: r.name })),
    eventTypes: eventTypes.map((e) => ({
      id: e.id,
      title: e.title,
      productId: e.productId ?? null,
    })),
  };
};
