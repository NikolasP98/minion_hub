import type { PageServerLoad } from './$types';
import { datasetCtx, isDenied } from '$server/auth/dataset-ctx';
import { listResources, listEventTypes } from '$server/services/scheduling.service';
import { schedulingTimeZone } from '$lib/components/scheduling/calendar-window';

/** View perm (`pos.appointments:view`) resolves through the longest-prefix rule
 *  on `/pos/appointments`, so this page is gated exactly like the calendar it
 *  came from — both by the root layout guard and by the composite
 *  `posAppointments` module-toggle guard. The booking POST is gated separately
 *  by `scheduling:edit` under `/api/scheduling`. */
export const load: PageServerLoad = async ({ locals }) => {
  const ctx = await datasetCtx(locals, 'pos');
  if (isDenied(ctx)) return { pos: ctx }; // rendered by DataSource in +page.svelte (spec 039)

  const [resources, eventTypes] = await Promise.all([listResources(ctx), listEventTypes(ctx)]);

  return {
    pos: {
      orgTz: schedulingTimeZone(resources),
      resources: resources.filter((r) => r.active).map((r) => ({ id: r.id, name: r.name })),
      eventTypes: eventTypes.map((e) => ({
        id: e.id,
        title: e.title,
        productId: e.productId ?? null,
        active: e.active,
        // The Team picker is limited to the service's assignees: forcing anyone
        // else is refused server-side (409) — see AppointmentForm `teamOptions`.
        resourceIds: e.resourceIds,
        length: e.length,
        /** Catalog list price (`fin_products.unit_price` through `productId`) and
         *  the org currency — the Services table's Price column. */
        price: e.price,
        currency: e.currency,
      })),
      stockEnabled: locals.moduleStates?.stock ?? true,
    },
  };
};
