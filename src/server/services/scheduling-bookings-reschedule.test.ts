import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createMockDb } from '$server/test-utils/mock-db';

vi.mock('./scheduling-slots.service', () => ({ serviceRulesOf: () => undefined }));
vi.mock('$server/events/emit', () => ({ emitHubEvent: async () => {} }));
vi.mock('./stock-accruals.service', () => ({
  accrueConsumption: async () => 0,
  releaseAccruals: async () => 0,
}));
vi.mock('./modules.service', () => ({ isModuleEnabled: async () => false }));

import { rescheduleBooking, BookingConflictError } from './scheduling-bookings.service';

beforeEach(() => {
  vi.clearAllMocks();
});

const ctx = (db: unknown) => ({ db: db as never, tenantId: 'org-1' });

const existing = {
  id: 'b1',
  orgId: 'org-1',
  status: 'accepted',
  eventTypeId: 'et-1',
  resourceId: 'staff-1',
  startTime: new Date('2026-08-10T15:00:00.000Z'),
  endTime: new Date('2026-08-10T15:30:00.000Z'),
  title: 'Haircut',
};

const newStart = new Date('2026-08-10T16:00:00.000Z');
const newEnd = new Date('2026-08-10T16:30:00.000Z');

describe('rescheduleBooking', () => {
  it('moves cleanly (no other bookings on the resource)', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([
      [existing], // select existing booking
      [], // other bookings on the resource
      [{ ...existing, startTime: newStart, endTime: newEnd, updatedAt: new Date() }], // update...returning()
    ]);

    const row = await rescheduleBooking(ctx(db), 'b1', { start: newStart, end: newEnd });

    expect(row.startTime).toEqual(newStart);
    expect(row.endTime).toEqual(newEnd);
  });

  it('does NOT 409 when only the event-type buffer would clash', async () => {
    const { db, resolveSequence } = createMockDb();
    // Another booking is 16:40–17:10 — no RAW overlap with the moved slot
    // (16:00–16:30). A stale buffer-padding rule would have padded it to
    // start at 16:25 and clashed; a move only clashes on a true overlap now
    // (owner directive 2026-09-28), so this resolves.
    const other = {
      id: 'b2',
      start: new Date('2026-08-10T16:40:00.000Z'),
      end: new Date('2026-08-10T17:10:00.000Z'),
      title: 'Manicure',
    };
    resolveSequence([
      [existing],
      [other],
      [{ ...existing, startTime: newStart, endTime: newEnd, updatedAt: new Date() }],
    ]);

    const row = await rescheduleBooking(ctx(db), 'b1', { start: newStart, end: newEnd });

    expect(row.startTime).toEqual(newStart);
  });

  it('back-to-back (moved end == neighbour start) is not a conflict', async () => {
    const { db, resolveSequence } = createMockDb();
    const movedStart = new Date('2026-08-10T13:30:00.000Z');
    const movedEnd = new Date('2026-08-10T14:00:00.000Z');
    const neighbour = {
      id: 'b2',
      start: movedEnd,
      end: new Date('2026-08-10T14:30:00.000Z'),
      title: 'Manicure',
    };
    resolveSequence([
      [existing],
      [neighbour],
      [{ ...existing, startTime: movedStart, endTime: movedEnd, updatedAt: new Date() }],
    ]);

    const row = await rescheduleBooking(ctx(db), 'b1', { start: movedStart, end: movedEnd });

    expect(row.startTime).toEqual(movedStart);
  });

  it('back-to-back the mirror way (neighbour end == moved start) is not a conflict', async () => {
    const { db, resolveSequence } = createMockDb();
    const movedStart = new Date('2026-08-10T13:30:00.000Z');
    const movedEnd = new Date('2026-08-10T14:00:00.000Z');
    const neighbour = {
      id: 'b2',
      start: new Date('2026-08-10T13:00:00.000Z'),
      end: movedStart,
      title: 'Manicure',
    };
    resolveSequence([
      [existing],
      [neighbour],
      [{ ...existing, startTime: movedStart, endTime: movedEnd, updatedAt: new Date() }],
    ]);

    const row = await rescheduleBooking(ctx(db), 'b1', { start: movedStart, end: movedEnd });

    expect(row.startTime).toEqual(movedStart);
  });

  it('rejects a cancelled booking before any conflict check', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([[{ ...existing, status: 'cancelled' }]]);

    await expect(
      rescheduleBooking(ctx(db), 'b1', { start: newStart, end: newEnd }),
    ).rejects.toThrow(/cancelled/);
  });

  it('rejects end <= start without touching the db', async () => {
    const { db, resolve } = createMockDb();
    resolve([]);
    const dbSpy = vi.mocked(db.select);

    await expect(
      rescheduleBooking(ctx(db), 'b1', { start: newEnd, end: newStart }),
    ).rejects.toThrow('end must be after start');
    expect(dbSpy).not.toHaveBeenCalled();
  });

  it('reports EVERY clash on the error, as ISO instants the UI can format', async () => {
    const { db, resolveSequence } = createMockDb();
    const clashes = [
      {
        id: 'b2',
        start: new Date('2026-08-10T16:15:00.000Z'),
        end: new Date('2026-08-10T16:45:00.000Z'),
        title: 'Manicure',
        metadata: null,
      },
      {
        id: 'b3',
        start: new Date('2026-08-10T16:00:00.000Z'),
        end: new Date('2026-08-10T16:10:00.000Z'),
        title: null,
        metadata: null,
      },
    ];
    resolveSequence([[existing], clashes]);

    const err = await rescheduleBooking(ctx(db), 'b1', {
      start: newStart,
      end: newEnd,
    }).catch((e) => e);

    expect(err).toBeInstanceOf(BookingConflictError);
    expect(err.conflicts).toEqual([
      {
        id: 'b2',
        title: 'Manicure',
        start: '2026-08-10T16:15:00.000Z',
        end: '2026-08-10T16:45:00.000Z',
        resourceId: 'staff-1',
      },
      {
        id: 'b3',
        title: null,
        start: '2026-08-10T16:00:00.000Z',
        end: '2026-08-10T16:10:00.000Z',
        resourceId: 'staff-1',
      },
    ]);
    // The old single-line message is kept verbatim for other clients/toasts.
    expect(err.message).toContain('Conflicts with "Manicure"');
  });

  it('lands the move anyway with overrideConflicts, clash and all', async () => {
    const { db, resolveSequence } = createMockDb();
    const other = {
      id: 'b2',
      start: newStart,
      end: newEnd,
      title: 'Manicure',
      metadata: null,
    };
    resolveSequence([[existing], [other], [{ ...existing, startTime: newStart, endTime: newEnd }]]);

    const row = await rescheduleBooking(ctx(db), 'b1', {
      start: newStart,
      end: newEnd,
      overrideConflicts: true,
    });

    expect(row.startTime).toEqual(newStart);
  });

  it('ignores members of the SAME merged visit — back-to-back is the point', async () => {
    const { db, resolveSequence } = createMockDb();
    // The sibling sits exactly where the booking is moving to (a true overlap):
    // same `groupId`, so it is exempted instead of counting as a clash.
    const sibling = {
      id: 'b2',
      start: newStart,
      end: newEnd,
      title: 'Botox',
      metadata: { groupId: 'g1' },
    };
    resolveSequence([
      [{ ...existing, metadata: { groupId: 'g1' } }],
      [sibling],
      [{ ...existing, startTime: newStart, endTime: newEnd }],
    ]);

    const row = await rescheduleBooking(ctx(db), 'b1', { start: newStart, end: newEnd });

    expect(row.startTime).toEqual(newStart);
  });

  it('still blocks a clash with a booking in ANOTHER visit', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([
      [{ ...existing, metadata: { groupId: 'g1' } }],
      [{ id: 'b9', start: newStart, end: newEnd, title: 'Other', metadata: { groupId: 'g2' } }],
    ]);

    await expect(
      rescheduleBooking(ctx(db), 'b1', { start: newStart, end: newEnd }),
    ).rejects.toBeInstanceOf(BookingConflictError);
  });
});
