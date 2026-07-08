import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createMockDb } from '$server/test-utils/mock-db';

// Mirrors scheduling-bookings-accrual.test.ts's mock style: isolate createBooking
// from the pure slot engine + side-effect hooks it delegates to.
const computeSlotsMock = vi.fn<(input: unknown) => Array<{ start: Date; resourceIds: string[] }>>(() => []);
vi.mock('$server/scheduling/slots', () => ({
  computeSlots: (input: unknown) => computeSlotsMock(input),
}));
vi.mock('./scheduling-slots.service', () => ({ serviceRulesOf: () => undefined }));
vi.mock('$server/events/emit', () => ({ emitHubEvent: async () => {} }));
vi.mock('./stock-accruals.service', () => ({
  accrueConsumption: async () => 0,
  releaseAccruals: async () => 0,
}));
vi.mock('./modules.service', () => ({ isModuleEnabled: async () => false }));

import { createBooking, SlotUnavailableError } from './scheduling-bookings.service';

beforeEach(() => {
  vi.clearAllMocks();
  computeSlotsMock.mockReturnValue([]);
});

const ctx = (db: unknown) => ({ db: db as never, tenantId: 'org-1' });

const et = {
  id: 'et-1',
  active: true,
  length: 30,
  title: 'Haircut',
  productId: null,
  requiresConfirmation: false,
  slotInterval: null,
  beforeBuffer: 0,
  afterBuffer: 0,
  minimumBookingNotice: 0,
  periodType: 'unlimited',
  periodDays: null,
  schedulingType: null,
};

describe('createBooking — forceResourceId / overrideConflicts', () => {
  it('forceResourceId busy at the slot rejects, even though another assignee is free', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([
      [et], // schedEventTypes lookup
      [{ resourceId: 'free-1' }, { resourceId: 'busy-1' }], // event-type assignees
      [{ id: 'busy-1' }], // active resources (narrowed to forced id)
      [], // loadAvailability: schedSchedules
      [], // loadBusyInTx: schedBookings
    ]);
    computeSlotsMock.mockReturnValue([]); // forced resource has no free slot at this start

    await expect(
      createBooking(ctx(db), {
        eventTypeId: 'et-1',
        start: new Date('2026-08-10T15:00:00.000Z'),
        forceResourceId: 'busy-1',
      }),
    ).rejects.toBeInstanceOf(SlotUnavailableError);
  });

  it('overrideConflicts books an off-hours time (no slots) with the forced resource, skipping slot computation', async () => {
    const { db, resolveSequence } = createMockDb();
    const start = new Date('2026-08-10T03:00:00.000Z'); // off-hours
    resolveSequence([
      [et],
      [{ resourceId: 'staff-1' }],
      [{ id: 'staff-1' }], // active + narrowed to forced id
      [{ id: 'book-1', orgId: 'org-1', resourceId: 'staff-1', startTime: start, endTime: new Date(start.getTime() + 30 * 60_000), status: 'accepted' }], // insert...returning()
    ]);

    const booking = await createBooking(ctx(db), {
      eventTypeId: 'et-1',
      start,
      forceResourceId: 'staff-1',
      overrideConflicts: true,
    });

    expect(booking.resourceId).toBe('staff-1');
    expect(computeSlotsMock).not.toHaveBeenCalled();
  });

  it('overrideConflicts without forceResourceId throws before touching the db', async () => {
    const { db } = createMockDb();
    await expect(
      createBooking(ctx(db), {
        eventTypeId: 'et-1',
        start: new Date('2026-08-10T15:00:00.000Z'),
        overrideConflicts: true,
      }),
    ).rejects.toThrow('overrideConflicts requires forceResourceId');
    expect(computeSlotsMock).not.toHaveBeenCalled();
  });

  it('default path (no forceResourceId/overrideConflicts) is unchanged: still runs slot computation', async () => {
    const { db, resolveSequence } = createMockDb();
    const start = new Date('2026-08-10T15:00:00.000Z');
    resolveSequence([
      [et],
      [{ resourceId: 'staff-1' }],
      [{ id: 'staff-1' }],
      [], // loadAvailability: schedSchedules
      [], // loadBusyInTx: schedBookings
      [{ id: 'book-2', orgId: 'org-1', resourceId: 'staff-1', startTime: start, endTime: new Date(start.getTime() + 30 * 60_000), status: 'accepted' }], // insert...returning()
    ]);
    computeSlotsMock.mockReturnValue([{ start, resourceIds: ['staff-1'] }]);

    const booking = await createBooking(ctx(db), { eventTypeId: 'et-1', start });

    expect(booking.resourceId).toBe('staff-1');
    expect(computeSlotsMock).toHaveBeenCalledTimes(1);
  });
});
