import type { PageServerLoad } from './$types';
import { error } from '@sveltejs/kit';
import { getCoreCtx } from '$server/auth/core-ctx';
import { getBooking } from '$server/services/scheduling-bookings.service';
import { listEventTypes, listEventKinds, listResources } from '$server/services/scheduling.service';
import { listTags } from '$server/services/crm-contacts.service';
import { getTagLinks } from '$server/services/tag-links.service';

/** `/scheduling/bookings/[id]/edit` — full CRUD edit for one booking (spec S5). */
export const load: PageServerLoad = async ({ locals, params }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401, 'Authentication required');
  const booking = await getBooking(ctx, params.id);
  if (!booking) throw error(404, 'Booking not found');

  const [eventTypes, kinds, resources, tags, tagsById] = await Promise.all([
    listEventTypes(ctx),
    listEventKinds(ctx),
    listResources(ctx),
    listTags(ctx),
    getTagLinks(ctx, 'booking', [booking.id]),
  ]);

  return {
    booking: {
      id: booking.id,
      title: booking.title,
      notes: booking.notes,
      status: booking.status,
      eventTypeId: booking.eventTypeId,
      productId: booking.productId,
      resourceId: booking.resourceId,
      kindId: booking.kindId,
      crmContactId: booking.crmContactId,
      partyId: booking.partyId,
      attendeeName: booking.attendeeName,
      attendeeEmail: booking.attendeeEmail,
      attendeePhone: booking.attendeePhone,
    },
    eventTypes: eventTypes.map((e) => ({
      id: e.id,
      title: e.title,
      productId: e.productId ?? null,
      active: e.active,
      length: e.length,
      kindId: e.kindId ?? null,
    })),
    kinds,
    resources,
    tags: tags.map((t) => ({ id: t.id, name: t.name, color: t.color })),
    currentTagIds: (tagsById.get(booking.id) ?? []).map((t) => t.id),
  };
};
