import { describe, expect, it } from 'vitest';
import { addBookingToCart, bookingCartConflicts, canChargeBooking } from './booking-checkout';
import { EMPTY_CUSTOMER } from './customer-storage';
import type { SellCartSellable } from './SellCart.svelte';

// Seeded browser and real package/instalment concurrency qualification are
// recorded in meta proposals/2026-09-19-hub-pos-two-flow-hardening.md.
const sellable: SellCartSellable = {
  productId: 'service',
  name: 'Service',
  code: 'S',
  category: null,
  unitPrice: 80,
  active: true,
  kind: 'service',
  itemId: null,
  stockQty: null,
  hasMapping: false,
};
const customer = { ...EMPTY_CUSTOMER, partyId: 'party', customerDocNumber: '12345678' };
const handoff = { bookingId: 'booking', productId: 'service', customer };

describe('booking checkout', () => {
  const detail = {
    booking: { status: 'completed' },
    grant: null,
    plan: null,
    tickets: [] as { status: string }[],
  };
  it('allows replacement after void history, but never beside live coverage', () => {
    expect(canChargeBooking({ ...detail, tickets: [{ status: 'void' }] })).toBe(true);
    expect(
      canChargeBooking({ ...detail, tickets: [{ status: 'void' }, { status: 'submitted' }] }),
    ).toBe(false);
  });
  it.each(['cancelled', 'rejected', 'no_show'])('does not charge %s appointments', (status) => {
    expect(canChargeBooking({ ...detail, booking: { status } })).toBe(false);
  });
  it('respects completion-only configuration and package/plan coverage', () => {
    expect(
      canChargeBooking({ ...detail, booking: { status: 'accepted' } }, 'after_completion'),
    ).toBe(false);
    expect(canChargeBooking(detail, 'after_completion')).toBe(true);
    expect(canChargeBooking({ ...detail, grant: {} })).toBe(false);
    expect(
      canChargeBooking({ ...detail, booking: { status: 'completed', paymentPlanId: 'plan' } }),
    ).toBe(false);
  });
  it('preserves existing lines and adds each booking once on reload or back', () => {
    const initial = [{ sellable, qty: 2, unitPrice: 80, discount: 0 }];
    const merged = addBookingToCart(initial, sellable, 'booking');
    expect(merged).toHaveLength(2);
    expect(merged[1]).toEqual(initial[0]);
    expect(addBookingToCart(merged, sellable, 'booking')).toEqual(merged);
  });
  it('requires a decision before replacing a different or unidentified customer cart', () => {
    const cart = addBookingToCart([], sellable, 'old');
    expect(bookingCartConflicts(cart, EMPTY_CUSTOMER, handoff)).toBe(true);
    expect(bookingCartConflicts(cart, { ...customer, partyId: 'other' }, handoff)).toBe(true);
    expect(bookingCartConflicts(cart, customer, handoff)).toBe(false);
    expect(bookingCartConflicts([], EMPTY_CUSTOMER, handoff)).toBe(false);
  });
});
