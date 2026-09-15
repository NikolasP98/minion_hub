import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createMockDb } from '$server/test-utils/mock-db';
import { PosError } from './pos.service';

/**
 * Slice S3: package redemption at booking time, atomic series, and the
 * cancel/no-show reversal that hands a session back (spec §3.2/§3.3).
 *
 * Mock style mirrors scheduling-bookings-override.test.ts: the pure slot engine
 * and every cross-service side effect are stubbed, so what's under test is the
 * ORDERING and the TRANSACTION BOUNDARY the booking service owns.
 */
const computeSlotsMock = vi.fn<
  (input: { rangeStart: Date }) => Array<{ start: Date; resourceIds: string[] }>
>((input) => [{ start: input.rangeStart, resourceIds: ['staff-1'] }]);
vi.mock('$server/scheduling/slots', () => ({
  computeSlots: (input: { rangeStart: Date }) => computeSlotsMock(input),
}));

// The mock db is filter-blind, so "only LATER series indexes" is invisible in
// the results — it lives in the `gt` predicate's arguments. Capture them.
const captured = vi.hoisted(() => ({ gt: [] as unknown[] }));
vi.mock('drizzle-orm', async (importOriginal) => {
  const actual = await importOriginal<typeof import('drizzle-orm')>();
  return {
    ...actual,
    gt: ((col: unknown, value: unknown) => {
      captured.gt.push(value);
      return (actual.gt as (c: unknown, v: unknown) => unknown)(col, value);
    }) as typeof actual.gt,
  };
});

const redeemMock = vi.fn<(grantId: string) => Promise<{ id: string }>>(async () => ({
  id: 'red-1',
}));
const reverseMock = vi.fn<(id: string) => Promise<{ id: string }>>(async (id) => ({ id }));
vi.mock('./pos-packages.service', () => ({
  redeemSessionInTx: (_tx: unknown, _org: string, input: { grantId: string }) =>
    redeemMock(input.grantId),
  reverseRedemptionInTx: (_tx: unknown, _org: string, id: string) => reverseMock(id),
  getGrant: async () => null,
}));
vi.mock('./pos-accounts.service', () => ({ getPlan: async () => null }));
vi.mock('./finance.service', () => ({
  getFinSettings: async () => ({ timezone: 'America/Lima' }),
}));
vi.mock('./scheduling-slots.service', () => ({ serviceRulesOf: () => undefined }));
vi.mock('$server/events/emit', () => ({ emitHubEvent: async () => {} }));

const accrueMock = vi.fn<() => Promise<number>>(async () => 1);
vi.mock('./stock-accruals.service', () => ({
  accrueConsumption: () => accrueMock(),
  releaseAccruals: async () => 1,
  accrualSummaryForSources: async () => [],
}));
vi.mock('./modules.service', () => ({ isModuleEnabled: async () => true }));

import {
  createBooking,
  createBookingSeries,
  setBookingStatus,
  cancelBooking,
} from './scheduling-bookings.service';

beforeEach(() => {
  vi.clearAllMocks();
  captured.gt.length = 0;
  computeSlotsMock.mockImplementation((input) => [
    { start: input.rangeStart, resourceIds: ['staff-1'] },
  ]);
  redeemMock.mockImplementation(async () => ({ id: 'red-1' }));
});

const ctx = (db: unknown) => ({ db: db as never, tenantId: 'org-1' });

const et = {
  id: 'et-1',
  active: true,
  length: 30,
  title: 'Laser session',
  productId: 'prod-1',
  requiresConfirmation: false,
  slotInterval: null,
  beforeBuffer: 0,
  afterBuffer: 0,
  minimumBookingNotice: 0,
  periodType: 'unlimited',
  periodDays: null,
  schedulingType: null,
};

const bookingRow = (id: string, start: Date) => ({
  id,
  orgId: 'org-1',
  resourceId: 'staff-1',
  startTime: start,
  endTime: new Date(start.getTime() + 30 * 60_000),
  status: 'accepted',
  productId: 'prod-1',
  seriesId: 's-1',
});

/** The db calls ONE occurrence makes, in order (slot path, no CRM lookup). */
const occurrence = (row: unknown) => [
  [et], // event type
  [{ resourceId: 'staff-1' }], // assignees
  [{ id: 'staff-1' }], // active resources
  [], // loadAvailability: schedSchedules
  [], // loadBusyInTx: schedBookings
  [row], // insert booking … returning()
  [], // insert sched_booking_status_log (creation row)
];

const slotAt = (h: number) => new Date(`2026-09-2${h}T15:00:00.000Z`);

describe('createBooking — package redemption', () => {
  it('redeems one session against the grant and stamps it on the booking', async () => {
    const { db, resolveSequence } = createMockDb();
    const start = slotAt(1);
    resolveSequence(occurrence(bookingRow('b-1', start)));

    const booking = await createBooking(ctx(db), {
      eventTypeId: 'et-1',
      start,
      packageGrantId: 'grant-1',
    });

    expect(booking.id).toBe('b-1');
    expect(redeemMock).toHaveBeenCalledWith('grant-1');
  });

  it('an exhausted grant fails the booking with the 409 code (package_exhausted)', async () => {
    const { db, resolveSequence } = createMockDb();
    const start = slotAt(1);
    resolveSequence(occurrence(bookingRow('b-1', start)));
    redeemMock.mockRejectedValueOnce(new PosError('no sessions left', 'package_exhausted'));

    await expect(
      createBooking(ctx(db), { eventTypeId: 'et-1', start, packageGrantId: 'grant-1' }),
    ).rejects.toMatchObject({ code: 'package_exhausted' });
  });
});

describe('createBookingSeries', () => {
  it('books N occurrences in ONE transaction, sharing a series id with 0-based indexes', async () => {
    const { db, resolveSequence } = createMockDb();
    const slots = [slotAt(1), slotAt(2), slotAt(3)];
    resolveSequence([
      ...occurrence(bookingRow('b-1', slots[0])),
      ...occurrence(bookingRow('b-2', slots[1])),
      ...occurrence(bookingRow('b-3', slots[2])),
    ]);

    const rows = await createBookingSeries(ctx(db), {
      eventTypeId: 'et-1',
      slots,
      packageGrantId: 'grant-1',
    });

    expect(rows.map((r) => r.id)).toEqual(['b-1', 'b-2', 'b-3']);
    expect(redeemMock).toHaveBeenCalledTimes(3);
    // ONE transaction for the whole series — this is the atomicity contract.
    expect(db.transaction).toHaveBeenCalledTimes(1);
    expect(accrueMock).toHaveBeenCalledTimes(3); // post-commit, one per booking
  });

  it('a failing 3rd slot aborts the whole series — no partial commit, no post-commit accrual', async () => {
    const { db, resolveSequence } = createMockDb();
    const slots = [slotAt(1), slotAt(2), slotAt(3)];
    resolveSequence([
      ...occurrence(bookingRow('b-1', slots[0])),
      ...occurrence(bookingRow('b-2', slots[1])),
      ...occurrence(bookingRow('b-3', slots[2])),
    ]);
    // Sessions 1 and 2 draw fine; the package runs dry on the third.
    redeemMock
      .mockResolvedValueOnce({ id: 'red-1' })
      .mockResolvedValueOnce({ id: 'red-2' })
      .mockRejectedValueOnce(new PosError('no sessions left', 'package_exhausted'));

    await expect(
      createBookingSeries(ctx(db), { eventTypeId: 'et-1', slots, packageGrantId: 'grant-1' }),
    ).rejects.toMatchObject({ code: 'package_exhausted' });

    // The two discriminators. (a) everything ran inside a SINGLE transaction, so
    // Postgres rolls the two earlier bookings AND their redemptions back — a
    // per-slot-transaction implementation would show 3 here and leave 2 rows
    // committed. (b) nothing reached the post-commit accrual hook, which only
    // runs for bookings that actually survived.
    expect(db.transaction).toHaveBeenCalledTimes(1);
    expect(accrueMock).not.toHaveBeenCalled();
  });

  it('rejects an empty slot list before touching the db', async () => {
    const { db } = createMockDb();
    await expect(createBookingSeries(ctx(db), { eventTypeId: 'et-1', slots: [] })).rejects.toThrow(
      'a series needs at least one slot',
    );
    expect(db.transaction).not.toHaveBeenCalled();
  });
});

describe('setBookingStatus — package reversal', () => {
  /** select current(for update) → update → insert log → select live redemptions. */
  const statusChange = (from: string, redemptions: Array<{ id: string }>) => [
    [{ status: from }],
    [],
    [],
    redemptions,
  ];

  it('cancelled hands the session back', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence(statusChange('accepted', [{ id: 'red-1' }]));
    await setBookingStatus(ctx(db), 'b-1', 'cancelled', { reason: 'client called' });
    expect(reverseMock).toHaveBeenCalledWith('red-1');
  });

  it('no_show hands the session back too', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence(statusChange('accepted', [{ id: 'red-1' }]));
    await setBookingStatus(ctx(db), 'b-1', 'no_show');
    expect(reverseMock).toHaveBeenCalledWith('red-1');
  });

  it('completed KEEPS the session consumed', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence(statusChange('accepted', [{ id: 'red-1' }]));
    await setBookingStatus(ctx(db), 'b-1', 'completed');
    expect(reverseMock).not.toHaveBeenCalled();
  });

  it('a no-op status change writes no log row and reverses nothing', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([[{ status: 'cancelled' }]]);
    await setBookingStatus(ctx(db), 'b-1', 'cancelled');
    expect(db.insert).not.toHaveBeenCalled();
    expect(reverseMock).not.toHaveBeenCalled();
  });
});

describe('cancelBooking — series scope', () => {
  it("scope 'following' cancels this occurrence and only STRICTLY LATER indexes", async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([
      [{ id: 'b-2', seriesId: 's-1', seriesIndex: 1 }], // the target occurrence
      [{ id: 'b-3' }, { id: 'b-4' }], // later, still-live occurrences
      // three setBookingStatus round-trips (b-2, b-3, b-4)
      [{ status: 'accepted' }],
      [],
      [],
      [],
      [{ status: 'accepted' }],
      [],
      [],
      [],
      [{ status: 'accepted' }],
      [],
      [],
      [],
    ]);

    const cancelled = await cancelBooking(ctx(db), 'b-2', { scope: 'following' });

    expect(cancelled).toEqual(['b-2', 'b-3', 'b-4']);
    // THE discriminator: the sibling query filters series_index > 1 — `gte`
    // would re-cancel index 1 twice and `>= 0` would take the past sessions
    // (indexes 0) with it. The mock db is filter-blind, so assert the predicate.
    expect(captured.gt).toEqual([1]);
  });

  it("scope 'one' touches only the booking itself", async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([
      [{ id: 'b-2', seriesId: 's-1', seriesIndex: 1 }],
      [{ status: 'accepted' }],
      [],
      [],
      [],
    ]);

    const cancelled = await cancelBooking(ctx(db), 'b-2', { scope: 'one' });

    expect(cancelled).toEqual(['b-2']);
    expect(captured.gt).toEqual([]); // no sibling query at all
  });

  it('an unknown booking cancels nothing (the route 404s on the empty list)', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([[]]);
    await expect(cancelBooking(ctx(db), 'nope')).resolves.toEqual([]);
  });
});
