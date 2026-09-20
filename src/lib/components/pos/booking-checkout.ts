import type { CartLine, SellCartSellable } from './SellCart.svelte';
import type { StoredCustomer } from './customer-storage';

export interface BookingCheckout {
  bookingId: string;
  productId: string;
  customer: StoredCustomer;
}

/** History stays visible, but only a submitted ticket provides live coverage. */
export function hasLiveBookingCharge(tickets: readonly { status: string }[]): boolean {
  return tickets.some((ticket) => ticket.status === 'submitted');
}

export function canChargeBooking(
  detail: {
    booking: { status: string; packageGrantId?: string | null; paymentPlanId?: string | null };
    grant: unknown;
    plan: unknown;
    tickets: readonly { status: string }[];
  },
  timing: 'any_time' | 'after_completion' = 'any_time',
): boolean {
  return (
    (timing === 'after_completion'
      ? detail.booking.status === 'completed'
      : ['pending', 'accepted', 'completed'].includes(detail.booking.status)) &&
    !detail.booking.packageGrantId &&
    !detail.booking.paymentPlanId &&
    !detail.grant &&
    !detail.plan &&
    !hasLiveBookingCharge(detail.tickets)
  );
}

/** An unidentified existing cart cannot safely be attributed to a new person. */
export function bookingCartConflicts(
  lines: readonly CartLine[],
  customer: StoredCustomer,
  next: BookingCheckout,
): boolean {
  if (lines.length === 0) return false;
  return !customer.partyId || customer.partyId !== next.customer.partyId;
}

export function addBookingToCart(
  lines: readonly CartLine[],
  sellable: SellCartSellable,
  bookingId: string,
): CartLine[] {
  if (lines.some((line) => line.bookingId === bookingId)) return [...lines];
  return [{ sellable, bookingId, qty: 1, unitPrice: sellable.unitPrice, discount: 0 }, ...lines];
}
