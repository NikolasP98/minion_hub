import type { PageServerLoad } from './$types';
import { error } from '@sveltejs/kit';
import { getCoreCtx } from '$server/auth/core-ctx';
import { listSellables, listTickets, listShifts } from '$server/services/pos.service';
import { listResources, listEventTypes } from '$server/services/scheduling.service';
import { getBookingDetail } from '$server/services/scheduling-bookings.service';
import { getParty } from '$server/services/party.service';
import { getContact } from '$server/services/crm-contacts.service';
import { requireOrgCapability, shouldMaskSensitive } from '$server/services/rbac.service';
import { maskPii } from '$lib/pii';
import { canChargeBooking, type BookingCheckout } from '$lib/components/pos/booking-checkout';

/** View perm (`pos.sell:view`) is enforced centrally by the root layout guard
 *  (MODULE_SUBRESOURCES) — this load only fetches the tab's data.
 *
 *  Event types + resources feed the `?step=schedule` third step (the same two
 *  reads `/pos/appointments/new` does). Skipped entirely when the scheduling
 *  module is off: that step then never renders, so fetching for it is waste. */
export const load: PageServerLoad = async ({ locals, depends, url, parent }) => {
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

  // The URL carries only an identifier. Customer, document, product and payment
  // eligibility are read in the active organization, never trusted from storage.
  const requestedBooking = url.searchParams.get('booking');
  let bookingCheckout: BookingCheckout | null = null;
  if (requestedBooking && schedulingEnabled && /^[0-9a-f-]{36}$/i.test(requestedBooking)) {
    await requireOrgCapability(locals, 'scheduling', 'view');
    const detail = await getBookingDetail(ctx, requestedBooking);
    const layout = await parent();
    if (
      detail &&
      canChargeBooking(detail, layout.posSettings.workflow?.appointmentPayment ?? 'any_time')
    ) {
      const productId = detail.booking.productId ?? detail.eventType?.productId;
      const contact =
        !detail.booking.partyId && detail.booking.crmContactId
          ? await getContact(ctx, detail.booking.crmContactId)
          : null;
      const partyId = detail.booking.partyId ?? contact?.contact.partyId;
      const party = partyId ? await getParty(ctx, partyId) : null;
      if (productId && sellables.some((s) => s.productId === productId) && (!partyId || party)) {
        const mask = await shouldMaskSensitive(locals, 'scheduling');
        bookingCheckout = {
          bookingId: detail.booking.id,
          productId,
          customer: {
            partyId: party?.id ?? null,
            customerName: party?.name ?? detail.booking.attendeeName,
            customerPhone: mask
              ? maskPii(party?.phone9 ?? detail.booking.attendeePhone ?? '')
              : (party?.phone9 ?? detail.booking.attendeePhone),
            customerDocNumber: party?.docNumber
              ? mask
                ? maskPii(party.docNumber)
                : party.docNumber
              : null,
          },
        };
      }
    }
  }

  return {
    bookingCheckout,
    bookingCheckoutUnavailable: Boolean(requestedBooking) && !bookingCheckout,
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
