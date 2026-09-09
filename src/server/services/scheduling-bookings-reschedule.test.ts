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
      [{ beforeBuffer: 0, afterBuffer: 0 }], // event-type buffers
      [], // other bookings on the resource
      [{ ...existing, startTime: newStart, endTime: newEnd, updatedAt: new Date() }], // update...returning()
    ]);

    const row = await rescheduleBooking(ctx(db), 'b1', { start: newStart, end: newEnd });

    expect(row.startTime).toEqual(newStart);
    expect(row.endTime).toEqual(newEnd);
  });

  it('409s (BookingConflictError) on overlap once event-type buffers pad the clash', async () => {
    const { db, resolveSequence } = createMockDb();
    // Another booking is 16:40–17:10 — no RAW overlap with the moved slot
    // (16:00–16:30). A 15min beforeBuffer pads it to start at 16:25, which now
    // overlaps the moved slot's 16:00–16:30.
    const other = {
      id: 'b2',
      start: new Date('2026-08-10T16:40:00.000Z'),
      end: new Date('2026-08-10T17:10:00.000Z'),
      title: 'Manicure',
    };
    resolveSequence([[existing], [{ beforeBuffer: 15, afterBuffer: 0 }], [other]]);

    await expect(
      rescheduleBooking(ctx(db), 'b1', { start: newStart, end: newEnd }),
    ).rejects.toBeInstanceOf(BookingConflictError);
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
});
