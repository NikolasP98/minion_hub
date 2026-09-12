import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createMockDb } from '$server/test-utils/mock-db';

const mocks = vi.hoisted(() => ({
  releaseAccruals: vi.fn<(ctx: unknown, source: string, sourceId: string) => Promise<number>>(
    async () => 0,
  ),
}));

vi.mock('./scheduling-slots.service', () => ({ serviceRulesOf: () => undefined }));
vi.mock('$server/events/emit', () => ({ emitHubEvent: async () => {} }));
vi.mock('./stock-accruals.service', () => ({
  accrueConsumption: async () => 0,
  releaseAccruals: (ctx: unknown, source: string, sourceId: string) =>
    mocks.releaseAccruals(ctx, source, sourceId),
}));
vi.mock('./modules.service', () => ({ isModuleEnabled: async () => false }));

import {
  updateBooking,
  deleteBooking,
  BookingConflictError,
  BookingReferencedError,
} from './scheduling-bookings.service';

beforeEach(() => {
  vi.clearAllMocks();
});

const ctx = (db: unknown) => ({ db: db as never, tenantId: 'org-1' });

const start = new Date('2026-08-10T15:00:00.000Z');
const end = new Date('2026-08-10T15:30:00.000Z');

const existing = {
  id: 'b1',
  orgId: 'org-1',
  status: 'accepted',
  eventTypeId: 'et-1',
  resourceId: 'staff-1',
  startTime: start,
  endTime: end,
  title: 'Haircut',
  notes: null,
  crmContactId: null,
  partyId: null,
  productId: 'p-old',
  kindId: null,
  attendeeName: 'Jane',
  attendeeEmail: null,
  attendeePhone: null,
};

describe('updateBooking', () => {
  it('derives productId from the new event type when none is passed explicitly', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([
      [existing], // getBooking (existing)
      [{ productId: 'p-new' }], // event-type lookup for the new eventTypeId
      [], // update(schedBookings)...set(...) — result unused
      [], // recordAuditInTx insert(docAuditLog)
      [{ ...existing, eventTypeId: 'et-2', productId: 'p-new' }], // getBooking (final)
    ]);

    const row = await updateBooking(ctx(db), 'b1', { eventTypeId: 'et-2' });

    expect(row.eventTypeId).toBe('et-2');
    expect(row.productId).toBe('p-new');
  });

  it('keeps an explicit productId over the event type default', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([
      [existing],
      [{ productId: 'p-new' }],
      [],
      [],
      [{ ...existing, eventTypeId: 'et-2', productId: 'p-explicit' }],
    ]);

    const row = await updateBooking(ctx(db), 'b1', {
      eventTypeId: 'et-2',
      productId: 'p-explicit',
    });

    expect(row.productId).toBe('p-explicit');
  });

  it('routes a resourceId change through rescheduleBooking, which runs the conflict check', async () => {
    const { db, resolveSequence } = createMockDb();
    const other = {
      id: 'b2',
      start,
      end,
      title: 'Another booking',
    };
    resolveSequence([
      [existing], // updateBooking's own getBooking
      [existing], // rescheduleBooking's internal existing-booking select
      [{ id: 'staff-2' }], // active-resource check
      [{ beforeBuffer: 0, afterBuffer: 0 }], // event-type buffers
      [other], // another booking already on staff-2 at the same time → overlap
    ]);

    await expect(updateBooking(ctx(db), 'b1', { resourceId: 'staff-2' })).rejects.toBeInstanceOf(
      BookingConflictError,
    );
  });
});

describe('deleteBooking', () => {
  it('hard-deletes an unreferenced booking and releases its open accruals', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([
      [{ id: 'b1', status: 'accepted' }], // existing
      [], // pos_ticket_lines lookup — none
      [], // sales_orders lookup — none
      [], // stk_accruals (realized) lookup — none
      [], // delete tag_links
      [], // delete sched_reminders
      [], // insert doc_audit_log
      [], // delete sched_bookings
    ]);

    await deleteBooking(ctx(db), 'b1');

    expect(mocks.releaseAccruals).toHaveBeenCalledWith(expect.anything(), 'booking', 'b1');
  });

  it('throws BookingReferencedError listing "ticket" when a POS ticket line references the booking', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([
      [{ id: 'b1', status: 'accepted' }], // existing
      [{ id: 'tl-1' }], // pos_ticket_lines lookup — a hit
      [], // sales_orders lookup — none
      [], // stk_accruals lookup — none
    ]);

    const err = await deleteBooking(ctx(db), 'b1').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BookingReferencedError);
    expect((err as InstanceType<typeof BookingReferencedError>).references).toEqual(['ticket']);
    expect(mocks.releaseAccruals).not.toHaveBeenCalled();
  });
});
