/**
 * `groupBookingResponse` is the merge/detach/move/status body-union handler shared by
 * `/api/pos/appointments/[id]/group` and `/api/scheduling/bookings/[id]/group`
 * (kit `booking-mover.ts` routes both surfaces here). The three body shapes'
 * OWN business logic is already covered at the service layer
 * (`src/server/services/scheduling-bookings-group.test.ts`); this file only
 * proves the handler's own wiring: schema validation, dispatch to the right
 * service call, and the 409→{conflicts} / 400 mapping. The `{status}` body owns
 * its member-eligibility walk HERE (no service call of its own beyond the
 * per-row `applyBookingStatus`), so that walk is covered in full below.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const groupBookingWith = vi.fn();
const ungroupBooking = vi.fn();
const moveGroup = vi.fn();
const bookingGroupId = vi.fn();
const reorderVisit = vi.fn();
const addServiceToVisit = vi.fn();
const removeServiceFromVisit = vi.fn();
const visitMembers = vi.fn();
const patchBooking = vi.fn();
const cancelBooking = vi.fn();
const getBooking = vi.fn();
const realizeAccruals = vi.fn();

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
  visitMembers: (...args: unknown[]) => visitMembers(...args),
  ACTIVE_STATUSES: ['accepted', 'pending'],
  patchBooking: (...args: unknown[]) => patchBooking(...args),
  cancelBooking: (...args: unknown[]) => cancelBooking(...args),
  getBooking: (...args: unknown[]) => getBooking(...args),
  BookingConflictError: FakeBookingConflictError,
  BookingReferencedError: FakeBookingReferencedError,
  // Unrelated exports other handlers in this module need at import time.
  createBooking: vi.fn(),
  createBookingGroup: vi.fn(),
  MAX_GROUP_MEMBERS: 6,
  getBookingDetail: vi.fn(),
  SlotUnavailableError: class extends Error {},
}));
vi.mock('$server/services/rbac.service', () => ({ shouldMaskSensitive: vi.fn() }));
vi.mock('$server/services/stock-accruals.service', () => ({
  realizeAccruals: (...args: unknown[]) => realizeAccruals(...args),
}));

const { groupBookingResponse } = await import('./_handlers');

const ctx = { profileId: 'p1' } as never;
const locals = { user: { displayName: 'Ana' } } as never;
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
    const res = await groupBookingResponse(ctx, locals, req({ withId: 'b2' }), 'b1');

    expect(groupBookingWith).toHaveBeenCalledWith(ctx, 'b1', 'b2', {
      overrideConflicts: undefined,
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, groupId: 'g1' });
  });

  it('{detach:true} dispatches to ungroupBooking and returns {ok, groupId:null, destroyed}', async () => {
    ungroupBooking.mockResolvedValue({ destroyed: true });
    const res = await groupBookingResponse(ctx, locals, req({ detach: true }), 'b1');

    expect(ungroupBooking).toHaveBeenCalledWith(ctx, 'b1', { overrideConflicts: undefined });
    expect(await res.json()).toEqual({ ok: true, groupId: null, destroyed: true });
  });

  it('{move} resolves the group id first, then dispatches to moveGroup', async () => {
    bookingGroupId.mockResolvedValue('g1');
    moveGroup.mockResolvedValue({ moved: 2 });
    const body = { move: { start: '2026-09-25T10:00:00.000Z', end: '2026-09-25T10:15:00.000Z' } };

    const res = await groupBookingResponse(ctx, locals, req(body), 'b1');

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

    await expect(groupBookingResponse(ctx, locals, req(body), 'b1')).rejects.toMatchObject({
      status: 400,
    });
    expect(moveGroup).not.toHaveBeenCalled();
  });

  it('threads overrideConflicts through to the merge call', async () => {
    groupBookingWith.mockResolvedValue({ groupId: 'g1' });
    await groupBookingResponse(ctx, locals, req({ withId: 'b2', overrideConflicts: true }), 'b1');

    expect(groupBookingWith).toHaveBeenCalledWith(ctx, 'b1', 'b2', { overrideConflicts: true });
  });

  it('maps a BookingConflictError to 409 {error, message, conflicts}', async () => {
    const conflicts = [{ id: 'x', title: null, start: 's', end: 'e', resourceId: 'r' }];
    groupBookingWith.mockRejectedValue(new FakeBookingConflictError('clash', conflicts));

    const res = await groupBookingResponse(ctx, locals, req({ withId: 'b2' }), 'b1');

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'conflict', message: 'clash', conflicts });
  });

  it('maps any other service error to 400', async () => {
    groupBookingWith.mockRejectedValue(new Error('nope'));

    await expect(
      groupBookingResponse(ctx, locals, req({ withId: 'b2' }), 'b1'),
    ).rejects.toMatchObject({
      status: 400,
    });
  });

  it('{reorder} resolves the group id first, then dispatches to reorderVisit', async () => {
    bookingGroupId.mockResolvedValue('g1');
    reorderVisit.mockResolvedValue({ reordered: 2 });

    const res = await groupBookingResponse(ctx, locals, req({ reorder: ['b', 'a'] }), 'a');

    expect(bookingGroupId).toHaveBeenCalledWith(ctx, 'a');
    expect(reorderVisit).toHaveBeenCalledWith(ctx, 'g1', ['b', 'a']);
    expect(await res.json()).toEqual({ ok: true, groupId: 'g1', reordered: 2 });
  });

  it('{reorder} 400s when the booking is not part of a merged visit', async () => {
    bookingGroupId.mockResolvedValue(null);

    await expect(
      groupBookingResponse(ctx, locals, req({ reorder: ['a', 'b'] }), 'a'),
    ).rejects.toMatchObject({ status: 400 });
    expect(reorderVisit).not.toHaveBeenCalled();
  });

  it('{addEventTypeId} dispatches to addServiceToVisit and returns its payload', async () => {
    addServiceToVisit.mockResolvedValue({ groupId: 'g1', booking: { id: 'b9' }, members: 3 });

    const res = await groupBookingResponse(
      ctx,
      locals,
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

    const res = await groupBookingResponse(ctx, locals, req({ removeService: true }), 'b1');

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

    const res = await groupBookingResponse(ctx, locals, req({ removeService: true }), 'b1');

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: 'referenced',
      references: ['ticket', 'order'],
      message: 'booking is referenced by: ticket, order',
    });
  });

  it('{removeService:false} is not a recognized shape', async () => {
    await expect(
      groupBookingResponse(ctx, locals, req({ removeService: false }), 'b1'),
    ).rejects.toMatchObject({ status: 400 });
    expect(removeServiceFromVisit).not.toHaveBeenCalled();
  });

  it('400s on a body matching none of the seven shapes', async () => {
    await expect(
      groupBookingResponse(ctx, locals, req({ nonsense: true }), 'b1'),
    ).rejects.toMatchObject({
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
    await expect(groupBookingResponse(ctx, locals, badReq, 'b1')).rejects.toMatchObject({
      status: 400,
    });
  });
});

/**
 * `{ status }` — the detail tray's footer buttons. One event = N `sched_bookings`
 * rows, so "Mark completed" on a 4-service event must complete all four. The
 * walk's rules under test: who is eligible, who is skipped, the order, and that
 * a mid-visit failure stops and reports what already moved.
 */
describe('groupBookingResponse {status}', () => {
  const row = (id: string) => ({
    id,
    startTime: new Date('2026-10-08T10:00:00.000Z'),
    endTime: new Date('2026-10-08T11:00:00.000Z'),
    resourceId: 'r1',
    status: 'completed',
    productId: null,
    partyId: null,
    title: 'Visit',
  });
  const visit = [
    { id: 'b1', status: 'accepted' },
    { id: 'b2', status: 'pending' },
    { id: 'b3', status: 'cancelled' },
    { id: 'b4', status: 'completed' },
  ];

  beforeEach(() => {
    patchBooking.mockImplementation((_c: unknown, id: string) => Promise.resolve(row(id)));
    realizeAccruals.mockResolvedValue({ stockWarning: null });
    cancelBooking.mockImplementation((_c: unknown, id: string) => Promise.resolve([id]));
    getBooking.mockImplementation((_c: unknown, id: string) => Promise.resolve(row(id)));
  });

  it('applies to the one row when the booking is ungrouped', async () => {
    visitMembers.mockResolvedValue({ groupId: null, members: [] });

    const res = await groupBookingResponse(ctx, locals, req({ status: 'completed' }), 'b1');

    expect(patchBooking).toHaveBeenCalledTimes(1);
    expect(patchBooking).toHaveBeenCalledWith(ctx, 'b1', {
      status: 'completed',
      reason: null,
      actor: { id: 'p1', name: 'Ana' },
    });
    expect(await res.json()).toEqual({
      ok: true,
      groupId: null,
      applied: ['b1'],
      skipped: [],
      stockWarning: null,
      warnings: [],
    });
  });

  it('completes every live member of a visit and skips the terminal ones', async () => {
    visitMembers.mockResolvedValue({ groupId: 'g1', members: visit });

    const res = await groupBookingResponse(ctx, locals, req({ status: 'completed' }), 'b1');

    expect(patchBooking.mock.calls.map((c) => c[1])).toEqual(['b1', 'b2']);
    // Each completed member realizes its OWN accruals — the whole point.
    expect(realizeAccruals).toHaveBeenCalledTimes(2);
    expect(await res.json()).toEqual({
      ok: true,
      groupId: 'g1',
      applied: ['b1', 'b2'],
      skipped: ['b3', 'b4'],
      stockWarning: null,
      warnings: [],
    });
  });

  it('target accepted only confirms the pending members', async () => {
    visitMembers.mockResolvedValue({ groupId: 'g1', members: visit });

    const res = await groupBookingResponse(ctx, locals, req({ status: 'accepted' }), 'b1');

    expect(patchBooking.mock.calls.map((c) => c[1])).toEqual(['b2']);
    expect(await res.json()).toMatchObject({ applied: ['b2'], skipped: ['b1', 'b3', 'b4'] });
  });

  it('cancels each live member through cancelBooking with scope one', async () => {
    visitMembers.mockResolvedValue({ groupId: 'g1', members: visit });

    const res = await groupBookingResponse(
      ctx,
      locals,
      req({ status: 'cancelled', reason: 'client called' }),
      'b1',
    );

    expect(cancelBooking.mock.calls.map((c) => [c[1], c[2]])).toEqual([
      ['b1', { reason: 'client called', actor: { id: 'p1', name: 'Ana' }, scope: 'one' }],
      ['b2', { reason: 'client called', actor: { id: 'p1', name: 'Ana' }, scope: 'one' }],
    ]);
    expect(patchBooking).not.toHaveBeenCalled();
    expect(await res.json()).toMatchObject({ applied: ['b1', 'b2'], skipped: ['b3', 'b4'] });
  });

  it('stops at the first failing member, 409s with its id, and reports what applied', async () => {
    visitMembers.mockResolvedValue({ groupId: 'g1', members: visit });
    const conflicts = [{ id: 'x', title: null, start: 's', end: 'e', resourceId: 'r' }];
    patchBooking.mockImplementation((_c: unknown, id: string) =>
      id === 'b2'
        ? Promise.reject(new FakeBookingConflictError('clash', conflicts))
        : Promise.resolve(row(id)),
    );

    const res = await groupBookingResponse(ctx, locals, req({ status: 'completed' }), 'b1');

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: 'conflict',
      message: 'b2: clash',
      conflicts,
      groupId: 'g1',
      applied: ['b1'],
      skipped: ['b3', 'b4'],
    });
  });

  it('surfaces the first member stockWarning and collects the rest into warnings', async () => {
    visitMembers.mockResolvedValue({ groupId: 'g1', members: visit });
    realizeAccruals
      .mockResolvedValueOnce({ stockWarning: { code: 'short', message: 'bin empty' } })
      .mockResolvedValueOnce({ stockWarning: { code: 'short', message: 'other bin' } });

    const res = await groupBookingResponse(ctx, locals, req({ status: 'completed' }), 'b1');

    expect(await res.json()).toMatchObject({
      stockWarning: { code: 'short', message: 'bin empty' },
      warnings: [{ code: 'short', message: 'other bin' }],
    });
  });

  it('400s when a scope is passed — a visit is one occurrence', async () => {
    await expect(
      groupBookingResponse(ctx, locals, req({ status: 'cancelled', scope: 'following' }), 'b1'),
    ).rejects.toMatchObject({ status: 400 });
    expect(visitMembers).not.toHaveBeenCalled();
    expect(cancelBooking).not.toHaveBeenCalled();
  });

  // The tray sends `reason: extra.reason ?? null`, so "no reason" arrives as an
  // explicit null: a string-only `optional()` 400'd EVERY visit-wide status
  // write with `expected string, received null`.
  it('accepts an explicit null reason', async () => {
    visitMembers.mockResolvedValue({ groupId: 'g1', members: [{ id: 'b1', status: 'accepted' }] });

    const res = await groupBookingResponse(
      ctx,
      locals,
      req({ status: 'completed', reason: null }),
      'b1',
    );

    expect(res.status).toBe(200);
    expect(patchBooking).toHaveBeenCalledWith(
      ctx,
      'b1',
      expect.objectContaining({ status: 'completed', reason: null }),
    );
  });

  it('400s on a status the visit-wide body does not accept', async () => {
    await expect(
      groupBookingResponse(ctx, locals, req({ status: 'bogus' }), 'b1'),
    ).rejects.toMatchObject({ status: 400 });
    expect(visitMembers).not.toHaveBeenCalled();
  });
});
