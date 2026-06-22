import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getCoreCtx } from '$server/auth/core-ctx';
import { isModuleEnabled } from '$server/services/modules.service';
import { listBookings } from '$server/services/scheduling-bookings.service';
import { listResources, listEventTypes } from '$server/services/scheduling.service';

export const load: PageServerLoad = async ({ locals, depends, url }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401, 'Authentication required');
  if (!(await isModuleEnabled(ctx, 'scheduling'))) throw error(404, 'Scheduling module disabled');
  depends('scheduling:data');

  // Default "today" in the ORG's timezone (resources carry it; the server runs
  // in UTC, so a bare toISOString() would show tomorrow late at night).
  const resources = await listResources(ctx);
  const orgTz = resources.find((r) => r.active)?.timezone ?? 'America/Lima';
  const todayInTz = new Intl.DateTimeFormat('en-CA', { timeZone: orgTz }).format(new Date()); // YYYY-MM-DD

  const dateParam = url.searchParams.get('date');
  const day = dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam) ? dateParam : todayInTz;
  const from = new Date(`${day}T00:00:00`);
  const to = new Date(from.getTime() + 86_400_000);

  const [bookings, eventTypes] = await Promise.all([
    listBookings(ctx, { from, to, status: ['accepted', 'pending', 'completed'], limit: 1000 }),
    listEventTypes(ctx),
  ]);

  return {
    day,
    resources: resources.filter((r) => r.active).map((r) => ({ id: r.id, name: r.name, color: r.color })),
    eventTypes: eventTypes.map((e) => ({ id: e.id, title: e.title })),
    bookings: bookings.map((b) => ({
      id: b.id,
      resourceId: b.resourceId,
      eventTypeId: b.eventTypeId,
      start: b.startTime.toISOString(),
      end: b.endTime.toISOString(),
      status: b.status,
      attendeeName: b.attendeeName,
    })),
  };
};
