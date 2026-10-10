import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createBookingMover } from './booking-mover';

const toastError = vi.fn();
vi.mock('$lib/state/ui/toast.svelte', () => ({
  toastError: (...a: unknown[]) => toastError(...a),
}));
vi.mock('$lib/paraglide/messages', () => ({
  sched_status_failed: () => 'status failed',
  cal_move_property_refused: ({ code }: { code: string }) => `property refused: ${code}`,
}));

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('createBookingMover', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let onError: (detail?: string) => void;
  let refresh: () => Promise<void>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    onError = vi.fn((_detail?: string) => {});
    refresh = vi.fn(async () => {});
    toastError.mockClear();
  });

  const next = {
    start: '2026-09-25T10:00:00.000Z',
    end: '2026-09-25T10:15:00.000Z',
    resourceId: 'r1',
  };

  it('PATCHes the booking itself for a plain move (no opts)', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ok: true }));
    const mover = createBookingMover({ apiBase: '/api/pos/appointments', onError, refresh });

    await mover.moveBooking('b1', next);

    expect(fetchMock).toHaveBeenCalledWith('/api/pos/appointments/b1', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(next),
    });
    expect(refresh).toHaveBeenCalledOnce();
  });

  it('PATCHes with overrideConflicts folded into the body for a plain override move', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ok: true }));
    const mover = createBookingMover({ apiBase: '/api/pos/appointments', onError, refresh });

    await mover.moveBooking('b1', next, { overrideConflicts: true });

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/pos/appointments/b1',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ ...next, overrideConflicts: true }),
      }),
    );
  });

  it('POSTs {withId} to the group route for mergeWith', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ok: true, groupId: 'g1' }));
    const mover = createBookingMover({ apiBase: '/api/scheduling/bookings', onError, refresh });

    await mover.moveBooking('b1', next, { mergeWith: 'b2' });

    expect(fetchMock).toHaveBeenCalledWith('/api/scheduling/bookings/b1/group', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ withId: 'b2' }),
    });
  });

  it('POSTs {detach:true} to the group route', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ok: true, groupId: null }));
    const mover = createBookingMover({ apiBase: '/api/pos/appointments', onError, refresh });

    await mover.moveBooking('b1', next, { detach: true });

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/pos/appointments/b1/group',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ detach: true }) }),
    );
  });

  it('POSTs {move} to the group route for group (whole-visit) moves, never fanning out per member', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ok: true, groupId: 'g1' }));
    const mover = createBookingMover({ apiBase: '/api/pos/appointments', onError, refresh });

    await mover.moveBooking('b1', next, { group: true, overrideConflicts: true });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/pos/appointments/b1/group',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ move: next, overrideConflicts: true }),
      }),
    );
  });

  it('returns {conflicts} on a 409 WITHOUT toasting or refreshing — nothing moved, nothing to revert', async () => {
    const conflicts = [
      { id: 'x', title: null, start: next.start, end: next.end, resourceId: 'r1' },
    ];
    fetchMock.mockResolvedValue(jsonResponse({ error: 'conflict', conflicts }, 409));
    const mover = createBookingMover({ apiBase: '/api/pos/appointments', onError, refresh });

    const result = await mover.moveBooking('b1', next);

    expect(result).toEqual({ conflicts });
    expect(onError).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });

  it('calls onError with the message on a non-409 failure, still refreshes', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ message: 'boom' }, 400));
    const mover = createBookingMover({ apiBase: '/api/pos/appointments', onError, refresh });

    await mover.moveBooking('b1', next);

    expect(onError).toHaveBeenCalledWith('boom');
    expect(refresh).toHaveBeenCalledOnce();
  });

  it('falls back to an HTTP-status message when the error body has none', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 500 }));
    const mover = createBookingMover({ apiBase: '/api/pos/appointments', onError, refresh });

    await mover.moveBooking('b1', next);

    expect(onError).toHaveBeenCalledWith('HTTP 500');
  });

  it('setStatus PATCHes {status} and refreshes', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ok: true }));
    const mover = createBookingMover({ apiBase: '/api/pos/appointments', onError, refresh });

    await mover.setStatus('b1', 'cancelled');

    expect(fetchMock).toHaveBeenCalledWith('/api/pos/appointments/b1', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'cancelled' }),
    });
    expect(refresh).toHaveBeenCalledOnce();
    expect(toastError).not.toHaveBeenCalled();
  });

  describe('setStatus optimism', () => {
    it('shows the intended status immediately, while the PATCH is in flight', async () => {
      let resolveFetch!: (r: Response) => void;
      fetchMock.mockReturnValue(new Promise((r) => (resolveFetch = r)));
      const mover = createBookingMover({ apiBase: '/api/pos/appointments', onError, refresh });

      const call = mover.setStatus('b1', 'cancelled');
      expect(mover.statusOf('b1', 'accepted')).toBe('cancelled');
      expect(mover.pending('b1')).toBe(true);

      resolveFetch(jsonResponse({ ok: true }));
      await call;
      expect(mover.pending('b1')).toBe(false);
      // The committed value now IS 'cancelled' (the caller's own reload), so
      // nothing about the overlay's own state need change here — it just
      // stops overriding.
      expect(mover.statusOf('b1', 'cancelled')).toBe('cancelled');
    });

    it('reverts and toasts on a non-OK response', async () => {
      fetchMock.mockResolvedValue(jsonResponse({ message: 'nope' }, 400));
      const mover = createBookingMover({ apiBase: '/api/pos/appointments', onError, refresh });

      await mover.setStatus('b1', 'cancelled');

      expect(mover.pending('b1')).toBe(false);
      expect(mover.statusOf('b1', 'accepted')).toBe('accepted');
      expect(toastError).toHaveBeenCalledOnce();
      expect(refresh).toHaveBeenCalledOnce();
    });

    it('reverts and toasts when the fetch itself throws', async () => {
      fetchMock.mockRejectedValue(new Error('offline'));
      const mover = createBookingMover({ apiBase: '/api/pos/appointments', onError, refresh });

      await mover.setStatus('b1', 'cancelled');

      expect(mover.statusOf('b1', 'accepted')).toBe('accepted');
      expect(toastError).toHaveBeenCalledOnce();
    });
  });

  describe('setVisitStatus', () => {
    it('POSTs {status} to the group route — not a PATCH on the one row', async () => {
      fetchMock.mockResolvedValue(jsonResponse({ ok: true, applied: ['b1', 'b2'], skipped: [] }));
      const mover = createBookingMover({ apiBase: '/api/scheduling/bookings', onError, refresh });

      await mover.setVisitStatus('b1', 'completed');

      expect(fetchMock).toHaveBeenCalledWith('/api/scheduling/bookings/b1/group', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status: 'completed' }),
      });
      expect(refresh).toHaveBeenCalledOnce();
      expect(toastError).not.toHaveBeenCalled();
    });

    it('carries a reason when given, and OMITS the key otherwise (the group body is a strictObject whose reason is a string)', async () => {
      fetchMock.mockResolvedValue(jsonResponse({ ok: true }));
      const mover = createBookingMover({ apiBase: '/api/scheduling/bookings', onError, refresh });

      await mover.setVisitStatus('b1', 'cancelled', 'client called');

      expect(fetchMock).toHaveBeenCalledWith(
        '/api/scheduling/bookings/b1/group',
        expect.objectContaining({
          body: JSON.stringify({ status: 'cancelled', reason: 'client called' }),
        }),
      );
      expect(JSON.parse(fetchMock.mock.calls[0][1].body)).not.toHaveProperty('reason', null);
    });

    it('paints optimistically on the id handed in, and reverts + toasts on a refusal', async () => {
      let resolveFetch!: (r: Response) => void;
      fetchMock.mockReturnValue(new Promise((r) => (resolveFetch = r)));
      const mover = createBookingMover({ apiBase: '/api/scheduling/bookings', onError, refresh });

      const call = mover.setVisitStatus('lead', 'no_show');
      expect(mover.statusOf('lead', 'accepted')).toBe('no_show');
      expect(mover.pending('lead')).toBe(true);

      resolveFetch(jsonResponse({ message: 'lead: overlaps' }, 409));
      await call;
      expect(mover.statusOf('lead', 'accepted')).toBe('accepted');
      expect(toastError).toHaveBeenCalledOnce();
      expect(refresh).toHaveBeenCalledOnce();
    });
  });

  describe('reorderVisit', () => {
    it('POSTs {reorder: ids} to the group route and refreshes', async () => {
      fetchMock.mockResolvedValue(jsonResponse({ ok: true, groupId: 'g1', reordered: 3 }));
      const mover = createBookingMover({ apiBase: '/api/pos/appointments', onError, refresh });

      await mover.reorderVisit('b1', ['c', 'a', 'b']);

      expect(fetchMock).toHaveBeenCalledWith('/api/pos/appointments/b1/group', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ reorder: ['c', 'a', 'b'] }),
      });
      expect(refresh).toHaveBeenCalledOnce();
    });

    it('calls onError with the message on failure, still refreshes', async () => {
      fetchMock.mockResolvedValue(jsonResponse({ message: 'nope' }, 400));
      const mover = createBookingMover({ apiBase: '/api/pos/appointments', onError, refresh });

      await mover.reorderVisit('b1', ['a', 'b']);

      expect(onError).toHaveBeenCalledWith('nope');
      expect(refresh).toHaveBeenCalledOnce();
    });
  });

  // ── HC-011D: a reclassifying drag carries its custom-column writes ON the
  // move request — never a second request.
  describe('properties ride on the move command', () => {
    const properties = [{ propertyId: 'p1', recordId: 'b1', value: 'opt-b', expectedVersion: 3 }];

    it('PATCH body carries `properties` exactly once for a single move', async () => {
      fetchMock.mockResolvedValue(jsonResponse({ ok: true }));
      const mover = createBookingMover({ apiBase: '/api/scheduling/bookings', onError, refresh });

      await mover.moveBooking('b1', next, { properties });

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('/api/scheduling/bookings/b1');
      expect(init.method).toBe('PATCH');
      expect(JSON.parse(init.body as string)).toEqual({ ...next, properties });
      expect((init.body as string).split('"properties"').length).toBe(2);
    });

    it('group POST body carries `properties` beside `move`, exactly once', async () => {
      fetchMock.mockResolvedValue(jsonResponse({ ok: true, groupId: 'g1' }));
      const mover = createBookingMover({ apiBase: '/api/pos/appointments', onError, refresh });
      const members = [
        ...properties,
        { propertyId: 'p1', recordId: 'b2', value: 'opt-b', expectedVersion: 0 },
      ];

      await mover.moveBooking('b1', next, {
        group: true,
        properties: members,
        overrideConflicts: true,
      });

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('/api/pos/appointments/b1/group');
      expect(JSON.parse(init.body as string)).toEqual({
        move: next,
        properties: members,
        overrideConflicts: true,
      });
      expect((init.body as string).split('"properties"').length).toBe(2);
    });

    it('an empty properties list is not sent at all', async () => {
      fetchMock.mockResolvedValue(jsonResponse({ ok: true }));
      const mover = createBookingMover({ apiBase: '/api/scheduling/bookings', onError, refresh });

      await mover.moveBooking('b1', next, { properties: [] });

      expect(
        JSON.parse((fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string),
      ).toEqual(next);
    });

    it('a property-stage refusal names that stage through onError and still refreshes (nothing moved)', async () => {
      fetchMock.mockResolvedValue(
        jsonResponse(
          { error: 'property', code: 'version_conflict', message: 'version_conflict' },
          409,
        ),
      );
      const mover = createBookingMover({ apiBase: '/api/scheduling/bookings', onError, refresh });

      const result = await mover.moveBooking('b1', next, { properties });

      expect(result).toBeUndefined();
      expect(onError).toHaveBeenCalledWith('property refused: version_conflict');
      expect(refresh).toHaveBeenCalledOnce();
    });

    it('a move-stage 409 with conflicts still returns {conflicts} for the dialog (lane rolled back server-side)', async () => {
      const conflicts = [
        { id: 'x', title: null, start: next.start, end: next.end, resourceId: 'r1' },
      ];
      fetchMock.mockResolvedValue(jsonResponse({ error: 'conflict', conflicts }, 409));
      const mover = createBookingMover({ apiBase: '/api/scheduling/bookings', onError, refresh });

      expect(await mover.moveBooking('b1', next, { properties })).toEqual({ conflicts });
      expect(onError).not.toHaveBeenCalled();
    });
  });
});
