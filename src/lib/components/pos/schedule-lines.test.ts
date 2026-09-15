import { describe, expect, it } from 'vitest';
import { isPendingScheduling, isScheduled } from './schedule-lines';

/**
 * QA found the till offering an INSTALMENT PAYMENT for scheduling: paying one
 * instalment of a plan adds a synthetic `plan:<uuid>` line that is
 * `kind: 'service'` with a null `booking_id`, which the old rule read as "a
 * service nobody has booked yet". Money is not a service.
 */
describe('pending-scheduling derivation', () => {
  const service = { kind: 'service', bookingId: null, planId: null };

  it('offers an unbooked service line', () => {
    expect(isPendingScheduling(service)).toBe(true);
    expect(isScheduled(service)).toBe(false);
  });

  it('does not offer a booked service line', () => {
    const booked = { ...service, bookingId: 'b1' };
    expect(isPendingScheduling(booked)).toBe(false);
    expect(isScheduled(booked)).toBe(true);
  });

  it('never offers a plan instalment, booked or not', () => {
    expect(isPendingScheduling({ ...service, planId: 'p1' })).toBe(false);
    expect(isPendingScheduling({ ...service, planId: 'p1', bookingId: 'b1' })).toBe(false);
    expect(isScheduled({ ...service, planId: 'p1', bookingId: 'b1' })).toBe(false);
  });

  it('never offers a product line', () => {
    expect(isPendingScheduling({ kind: 'product', bookingId: null, planId: null })).toBe(false);
    expect(isScheduled({ kind: 'product', bookingId: 'b1', planId: null })).toBe(false);
  });

  it('treats a missing planId the same as an explicit null', () => {
    expect(isPendingScheduling({ kind: 'service', bookingId: null })).toBe(true);
  });
});
