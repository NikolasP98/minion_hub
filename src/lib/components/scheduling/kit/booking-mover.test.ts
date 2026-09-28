import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createBookingMover } from './booking-mover';

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
  });
});
