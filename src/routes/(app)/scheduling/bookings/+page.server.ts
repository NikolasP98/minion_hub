import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getCoreCtx } from '$server/auth/core-ctx';
import { isModuleEnabled } from '$server/services/modules.service';
import { listBookings } from '$server/services/scheduling-bookings.service';
import { listResources, listEventTypes } from '$server/services/scheduling.service';

const DAY = 86_400_000;

export const load: PageServerLoad = async ({ locals, depends }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401, 'Authentication required');
  if (!(await isModuleEnabled(ctx, 'scheduling'))) throw error(404, 'Scheduling module disabled');
  depends('scheduling:data');

  const now = Date.now();
  const [bookings, resources, eventTypes] = await Promise.all([
    listBookings(ctx, { from: new Date(now - 30 * DAY), to: new Date(now + 90 * DAY), limit: 500 }),
    listResources(ctx),
    listEventTypes(ctx),
  ]);
  return {
    bookings,
    resources: resources.map((r) => ({ id: r.id, name: r.name })),
    eventTypes: eventTypes.map((e) => ({ id: e.id, title: e.title })),
  };
};
