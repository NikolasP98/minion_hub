/**
 * The `/pos/appointments` → `/pos/sell` charge hand-off contract.
 *
 * A completed booking is written to a consume-once `localStorage` key; the sell
 * screen reads it once on mount, deletes it, and pre-fills the cart with the
 * booking's service line (`(app)/pos/sell/+page.svelte`, `CHARGE_KEY`). Keeping
 * the key and the payload shape here — instead of inline in the page — is what
 * lets the hand-off be asserted without mounting the whole POS screen.
 */
import type {
  BookingsViewBooking,
  BookingsViewEventType,
} from '$lib/components/scheduling/bookings-view';

export type ChargeHandoff = {
  bookingId: string;
  productId: string | null;
  partyId: string | null;
  customerName: string | null;
  phone: string | null;
};

/** Per-org key: a charge staged in one org must not surface in another. */
export function chargeStorageKey(orgId: string | null | undefined): string {
  return `pos-charge-${orgId ?? 'default'}`;
}

/**
 * The booking's own `productId` wins over its event type's: a booking may have
 * been taken against a service that has since been re-pointed at another
 * product, and the ticket must bill what was actually booked.
 */
export function chargeHandoff(
  booking: BookingsViewBooking,
  eventTypes: readonly BookingsViewEventType[],
): ChargeHandoff {
  const eventType = eventTypes.find((e) => e.id === booking.eventTypeId);
  return {
    bookingId: booking.id,
    productId: booking.productId ?? eventType?.productId ?? null,
    partyId: booking.partyId ?? null,
    customerName: booking.attendeeName ?? null,
    phone: booking.attendeePhone ?? null,
  };
}
