import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getCoreCtx } from '$server/auth/core-ctx';
import { listResources, listEventTypes } from '$server/services/scheduling.service';

/** View perm (`pos.appointments:view`) resolves through the longest-prefix rule
 *  on `/pos/appointments`, so this page is gated exactly like the calendar it
 *  came from — both by the root layout guard and by the composite
 *  `posAppointments` module-toggle guard. The booking POST is gated separately
 *  by `scheduling:edit` under `/api/scheduling`. */
export const load: PageServerLoad = async ({ locals }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401, 'Authentication required');

  const [resources, eventTypes] = await Promise.all([listResources(ctx), listEventTypes(ctx)]);

  return {
    resources: resources.filter((r) => r.active).map((r) => ({ id: r.id, name: r.name })),
    eventTypes: eventTypes.map((e) => ({
      id: e.id,
      title: e.title,
      productId: e.productId ?? null,
      // The Team picker is limited to the service's assignees: forcing anyone
      // else is refused server-side (409) — see AppointmentForm `teamOptions`.
      resourceIds: e.resourceIds,
      length: e.length,
    })),
    stockEnabled: locals.moduleStates?.stock ?? true,
  };
};
