import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createMockDb } from '$server/test-utils/mock-db';

// Mirrors scheduling-bookings-accrual.test.ts's mock style: isolate createBooking
// from the pure slot engine + side-effect hooks it delegates to.
const computeSlotsMock = vi.fn<(input: unknown) => Array<{ start: Date; resourceIds: string[] }>>(() => []);
vi.mock('$server/scheduling/slots', () => ({
  computeSlots: (input: unknown) => computeSlotsMock(input),
}));
// The mock db is filter-blind (where-clauses are ignored; resolveSequence slots are
// returned verbatim), so candidate narrowing is invisible through query RESULTS —
// and `candidateIds = active.map(...)` overwrites the narrowed list with whatever
// the mock returns. Narrowing IS visible through query ARGUMENTS: capture every
// value list handed to drizzle's inArray so test (a) can prove the candidate set
// was narrowed to the forced resource BEFORE the slot engine ran.
const captured = vi.hoisted(() => ({ inArrayValues: [] as unknown[] }));
vi.mock('drizzle-orm', async (importOriginal) => {
  const actual = await importOriginal<typeof import('drizzle-orm')>();
  return {
    ...actual,
    inArray: ((col: unknown, values: unknown) => {
      captured.inArrayValues.push(values);
      return (actual.inArray as (c: unknown, v: unknown) => unknown)(col, values);
    }) as typeof actual.inArray,
  };
});
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
  captured.inArrayValues.length = 0;
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
      [{ resourceId: 'free-1' }, { resourceId: 'busy-1' }], // event-type assignees: free-1 IS genuinely free
      [{ id: 'busy-1' }], // active resources (real DB would return only the narrowed id)
      [], // loadAvailability: schedSchedules
      [], // loadBusyInTx: schedBookings
    ]);
    // Behavior-faithful engine stub: the engine only ever offers resources it was
    // given (resourceIds ⊆ input resources). Narrowing hands it busy-1 alone, and
    // busy-1 is busy at `start`, so it returns no slot — free-1's availability
    // never reaches the engine, so it cannot be silently picked.
    computeSlotsMock.mockReturnValue([]);

    await expect(
      createBooking(ctx(db), {
        eventTypeId: 'et-1',
        start: new Date('2026-08-10T15:00:00.000Z'),
        forceResourceId: 'busy-1',
      }),
    ).rejects.toBeInstanceOf(SlotUnavailableError);

    // Failure point: the engine DID run (throw came from the exact-start no-match
    // check, not from empty candidates).
    expect(computeSlotsMock).toHaveBeenCalledTimes(1);

    // THE discriminator. Every resource-id list the service sent to the DB after
    // the force filter must be exactly ['busy-1'] — the active-resource query is
    // the first of them and directly reflects the narrowed candidate set. With
    // the narrowing line deleted, it receives ['free-1','busy-1'] and this fails.
    const resourceIdLists = captured.inArrayValues.filter(
      (v): v is string[] => Array.isArray(v) && (v.includes('busy-1') || v.includes('free-1')),
    );
    expect(resourceIdLists.length).toBeGreaterThan(0);
    for (const list of resourceIdLists) expect(list).toEqual(['busy-1']);
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
