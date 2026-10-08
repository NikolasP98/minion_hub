/**
 * `groupBookingResponse` is the merge/detach/move body-union handler shared by
 * `/api/pos/appointments/[id]/group` and `/api/scheduling/bookings/[id]/group`
 * (kit `booking-mover.ts` routes both surfaces here). The three body shapes'
 * OWN business logic is already covered at the service layer
 * (`src/server/services/scheduling-bookings-group.test.ts`); this file only
 * proves the handler's own wiring: schema validation, dispatch to the right
 * service call, and the 409→{conflicts} / 400 mapping.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const groupBookingWith = vi.fn();
const ungroupBooking = vi.fn();
const moveGroup = vi.fn();
const bookingGroupId = vi.fn();
const reorderVisit = vi.fn();
const addServiceToVisit = vi.fn();
const removeServiceFromVisit = vi.fn();

class FakeBookingConflictError extends Error {
  conflicts: unknown[];
  constructor(message: string, conflicts: unknown[]) {
    super(message);
    this.conflicts = conflicts;
  }
}
class FakeBookingReferencedError extends Error {
  references: unknown[];
  constructor(references: unknown[]) {
    super(`booking is referenced by: ${references.join(', ')}`);
    this.references = references;
  }
}

vi.mock('$server/services/scheduling-bookings.service', () => ({
  groupBookingWith: (...args: unknown[]) => groupBookingWith(...args),
  ungroupBooking: (...args: unknown[]) => ungroupBooking(...args),
  moveGroup: (...args: unknown[]) => moveGroup(...args),
  bookingGroupId: (...args: unknown[]) => bookingGroupId(...args),
  reorderVisit: (...args: unknown[]) => reorderVisit(...args),
  addServiceToVisit: (...args: unknown[]) => addServiceToVisit(...args),
  removeServiceFromVisit: (...args: unknown[]) => removeServiceFromVisit(...args),
  BookingConflictError: FakeBookingConflictError,
  BookingReferencedError: FakeBookingReferencedError,
  // Unrelated exports other handlers in this module need at import time.
  createBooking: vi.fn(),
  createBookingGroup: vi.fn(),
  MAX_GROUP_MEMBERS: 6,
  patchBooking: vi.fn(),
  cancelBooking: vi.fn(),
  getBooking: vi.fn(),
  getBookingDetail: vi.fn(),
  SlotUnavailableError: class extends Error {},
}));
vi.mock('$server/services/rbac.service', () => ({ shouldMaskSensitive: vi.fn() }));
vi.mock('$server/services/stock-accruals.service', () => ({ realizeAccruals: vi.fn() }));

const { groupBookingResponse } = await import('./_handlers');

const ctx = { profileId: 'p1' } as never;
const req = (body: unknown) =>
  new Request('http://x', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

beforeEach(() => {
  vi.clearAllMocks();
});

describe('groupBookingResponse', () => {
  it('{withId} dispatches to groupBookingWith and returns {ok, groupId}', async () => {
    groupBookingWith.mockResolvedValue({ groupId: 'g1' });
    const res = await groupBookingResponse(ctx, req({ withId: 'b2' }), 'b1');

    expect(groupBookingWith).toHaveBeenCalledWith(ctx, 'b1', 'b2', {
      overrideConflicts: undefined,
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, groupId: 'g1' });
  });

  it('{detach:true} dispatches to ungroupBooking and returns {ok, groupId:null, destroyed}', async () => {
    ungroupBooking.mockResolvedValue({ destroyed: true });
    const res = await groupBookingResponse(ctx, req({ detach: true }), 'b1');

    expect(ungroupBooking).toHaveBeenCalledWith(ctx, 'b1', { overrideConflicts: undefined });
    expect(await res.json()).toEqual({ ok: true, groupId: null, destroyed: true });
  });

  it('{move} resolves the group id first, then dispatches to moveGroup', async () => {
    bookingGroupId.mockResolvedValue('g1');
    moveGroup.mockResolvedValue({ moved: 2 });
    const body = { move: { start: '2026-09-25T10:00:00.000Z', end: '2026-09-25T10:15:00.000Z' } };

    const res = await groupBookingResponse(ctx, req(body), 'b1');

    expect(bookingGroupId).toHaveBeenCalledWith(ctx, 'b1');
    expect(moveGroup).toHaveBeenCalledWith(ctx, 'g1', {
      start: new Date(body.move.start),
      end: new Date(body.move.end),
      overrideConflicts: undefined,
    });
    expect(await res.json()).toEqual({ ok: true, groupId: 'g1', moved: 2 });
  });

  it('{move} 400s when the booking is not part of a merged visit', async () => {
    bookingGroupId.mockResolvedValue(null);
    const body = { move: { start: '2026-09-25T10:00:00.000Z', end: '2026-09-25T10:15:00.000Z' } };

    await expect(groupBookingResponse(ctx, req(body), 'b1')).rejects.toMatchObject({ status: 400 });
    expect(moveGroup).not.toHaveBeenCalled();
  });

  it('threads overrideConflicts through to the merge call', async () => {
    groupBookingWith.mockResolvedValue({ groupId: 'g1' });
    await groupBookingResponse(ctx, req({ withId: 'b2', overrideConflicts: true }), 'b1');

    expect(groupBookingWith).toHaveBeenCalledWith(ctx, 'b1', 'b2', { overrideConflicts: true });
  });

  it('maps a BookingConflictError to 409 {error, message, conflicts}', async () => {
    const conflicts = [{ id: 'x', title: null, start: 's', end: 'e', resourceId: 'r' }];
    groupBookingWith.mockRejectedValue(new FakeBookingConflictError('clash', conflicts));

    const res = await groupBookingResponse(ctx, req({ withId: 'b2' }), 'b1');

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'conflict', message: 'clash', conflicts });
  });

  it('maps any other service error to 400', async () => {
    groupBookingWith.mockRejectedValue(new Error('nope'));

    await expect(groupBookingResponse(ctx, req({ withId: 'b2' }), 'b1')).rejects.toMatchObject({
      status: 400,
    });
  });

  it('{reorder} resolves the group id first, then dispatches to reorderVisit', async () => {
    bookingGroupId.mockResolvedValue('g1');
    reorderVisit.mockResolvedValue({ reordered: 2 });

    const res = await groupBookingResponse(ctx, req({ reorder: ['b', 'a'] }), 'a');

    expect(bookingGroupId).toHaveBeenCalledWith(ctx, 'a');
    expect(reorderVisit).toHaveBeenCalledWith(ctx, 'g1', ['b', 'a']);
    expect(await res.json()).toEqual({ ok: true, groupId: 'g1', reordered: 2 });
  });

  it('{reorder} 400s when the booking is not part of a merged visit', async () => {
    bookingGroupId.mockResolvedValue(null);

    await expect(
      groupBookingResponse(ctx, req({ reorder: ['a', 'b'] }), 'a'),
    ).rejects.toMatchObject({ status: 400 });
    expect(reorderVisit).not.toHaveBeenCalled();
  });

  it('{addEventTypeId} dispatches to addServiceToVisit and returns its payload', async () => {
    addServiceToVisit.mockResolvedValue({ groupId: 'g1', booking: { id: 'b9' }, members: 3 });

    const res = await groupBookingResponse(
      ctx,
      req({ addEventTypeId: 'et-c', overrideConflicts: true }),
      'b1',
    );

    expect(addServiceToVisit).toHaveBeenCalledWith(ctx, 'b1', 'et-c', {
      overrideConflicts: true,
    });
    expect(await res.json()).toEqual({
      ok: true,
      groupId: 'g1',
      booking: { id: 'b9' },
      members: 3,
    });
  });

  it('{removeService:true} dispatches to removeServiceFromVisit and returns its payload', async () => {
    removeServiceFromVisit.mockResolvedValue({
      removed: 'b1',
      groupId: 'g1',
      destroyed: true,
    });

    const res = await groupBookingResponse(ctx, req({ removeService: true }), 'b1');

    expect(removeServiceFromVisit).toHaveBeenCalledWith(ctx, 'b1');
    expect(await res.json()).toEqual({
      ok: true,
      removed: 'b1',
      groupId: 'g1',
      destroyed: true,
    });
  });

  it('maps a BookingReferencedError to 409 {error:"referenced", references, message}', async () => {
    removeServiceFromVisit.mockRejectedValue(new FakeBookingReferencedError(['ticket', 'order']));

    const res = await groupBookingResponse(ctx, req({ removeService: true }), 'b1');

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: 'referenced',
      references: ['ticket', 'order'],
      message: 'booking is referenced by: ticket, order',
    });
  });

  it('{removeService:false} is not a recognized shape', async () => {
    await expect(
      groupBookingResponse(ctx, req({ removeService: false }), 'b1'),
    ).rejects.toMatchObject({ status: 400 });
    expect(removeServiceFromVisit).not.toHaveBeenCalled();
  });

  it('400s on a body matching none of the six shapes', async () => {
    await expect(groupBookingResponse(ctx, req({ nonsense: true }), 'b1')).rejects.toMatchObject({
      status: 400,
    });
    expect(groupBookingWith).not.toHaveBeenCalled();
    expect(ungroupBooking).not.toHaveBeenCalled();
    expect(moveGroup).not.toHaveBeenCalled();
  });

  it('400s on invalid JSON', async () => {
    const badReq = new Request('http://x', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{not json',
    });
    await expect(groupBookingResponse(ctx, badReq, 'b1')).rejects.toMatchObject({ status: 400 });
  });
});
