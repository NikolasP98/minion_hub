/**
 * Spec 116 slice 5 — the complete endpoint (POS path re-exports it) no longer
 * pre-checks the status itself: the status owner refuses a closed booking and
 * the route answers 409 `invalid_transition`, writing nothing and realizing no
 * stock. Completing a completed booking stays idempotent.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  getBooking: vi.fn(),
  setBookingStatus: vi.fn(),
  realizeAccruals: vi.fn(),
  hasCap: vi.fn(),
}));

class FakeBookingTransitionError extends Error {
  readonly code = 'invalid_transition';
}

vi.mock('$server/auth/authorize', () => ({ requireAuth: () => ({ id: 'u1' }) }));
vi.mock('$server/auth/core-ctx', () => ({
  getCoreCtx: async () => ({ db: {}, tenantId: 'org-1', profileId: 'p1' }),
}));
vi.mock('$server/services/modules.service', () => ({ isModuleEnabled: async () => true }));
vi.mock('$server/services/scheduling-bookings.service', () => ({
  getBooking: (...a: unknown[]) => h.getBooking(...a),
  setBookingStatus: (...a: unknown[]) => h.setBookingStatus(...a),
  BookingTransitionError: FakeBookingTransitionError,
  MAX_GROUP_MEMBERS: 6, // read at import time by the shared handler module
}));
class FakeStale extends Error {
  readonly code = 'recovery_preview_stale';
}
vi.mock('$server/services/stock-accruals.service', () => ({
  realizeAccruals: (...a: unknown[]) => h.realizeAccruals(...a),
  RecoveryPreviewStaleError: FakeStale,
  listAccruals: vi.fn(),
}));
vi.mock('$server/services/rbac.service', () => ({
  hasOrgCapability: (...a: unknown[]) => h.hasCap(...a),
  shouldMaskSensitive: vi.fn(),
}));

const { POST } = await import('./+server');

const call = (body: unknown = {}) =>
  POST({
    locals: { user: { id: 'u1' } },
    params: { id: 'b1' },
    request: new Request('http://x', {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'content-type': 'application/json' },
    }),
  } as never);

const booking = (status: string) => ({
  id: 'b1',
  title: 'Botox',
  status,
  productId: null,
  partyId: null,
});

beforeEach(() => {
  vi.clearAllMocks();
  h.realizeAccruals.mockResolvedValue({ entry: null, stockWarning: null });
  h.hasCap.mockResolvedValue(true);
});

describe('POST /api/scheduling/bookings/[id]/complete', () => {
  it('a no-show booking answers 409 invalid_transition and realizes nothing', async () => {
    h.getBooking.mockResolvedValue(booking('no_show'));
    h.setBookingStatus.mockRejectedValue(
      new FakeBookingTransitionError('booking is no_show; it cannot become completed'),
    );

    const res = await call();

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: 'invalid_transition',
      message: 'booking is no_show; it cannot become completed',
    });
    expect(h.realizeAccruals).not.toHaveBeenCalled();
  });

  it('a completed booking is idempotent: no status write, the realize runs again', async () => {
    h.getBooking.mockResolvedValue(booking('completed'));

    const res = await call();

    expect(res.status).toBe(200);
    expect(h.setBookingStatus).not.toHaveBeenCalled();
    expect(h.realizeAccruals).toHaveBeenCalledTimes(1);
  });

  it('a live booking completes, then realizes', async () => {
    h.getBooking.mockResolvedValue(booking('accepted'));
    h.setBookingStatus.mockResolvedValue(undefined);

    const res = await call();

    expect(res.status).toBe(200);
    expect(h.setBookingStatus).toHaveBeenCalledWith(expect.anything(), 'b1', 'completed');
  });
});

describe('POST …/complete with `recovery` (spec 126 confirm_open)', () => {
  const recovery = {
    mode: 'confirm_open',
    expectedOpenCount: 2,
    expectedOpenFingerprint: 'a'.repeat(64),
  };

  it('on a completed booking: no status write, realizes with the precondition and explicit lines', async () => {
    h.getBooking.mockResolvedValue(booking('completed'));
    const res = await call({ lines: [{ itemId: 'i1', qty: 1 }], recovery });
    expect(res.status).toBe(200);
    expect(h.setBookingStatus).not.toHaveBeenCalled();
    expect(h.realizeAccruals).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        lines: [{ itemId: 'i1', qty: 1 }],
        recovery: { expectedOpenCount: 2, expectedOpenFingerprint: 'a'.repeat(64) },
      }),
    );
  });

  it('a confirmed zero (`lines: []`) is explicit and passes through', async () => {
    h.getBooking.mockResolvedValue(booking('completed'));
    expect((await call({ lines: [], recovery })).status).toBe(200);
    expect(h.realizeAccruals).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ lines: [] }),
    );
  });

  it('refuses recovery without explicit lines before anything runs', async () => {
    h.getBooking.mockResolvedValue(booking('completed'));
    await expect(call({ recovery })).rejects.toMatchObject({ status: 400 });
    await expect(call({ lines: null, recovery })).rejects.toMatchObject({ status: 400 });
    expect(h.realizeAccruals).not.toHaveBeenCalled();
  });

  it('refuses a booking that is not completed: never completes it, never realizes', async () => {
    h.getBooking.mockResolvedValue(booking('accepted'));
    const res = await call({ lines: [], recovery });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe('recovery_not_completed');
    expect(h.setBookingStatus).not.toHaveBeenCalled();
    expect(h.realizeAccruals).not.toHaveBeenCalled();
  });

  it('needs stock:view and stock:manage', async () => {
    h.getBooking.mockResolvedValue(booking('completed'));
    h.hasCap.mockImplementation(
      async (_l: unknown, _m: string, action: string) => action !== 'manage',
    );
    const res = await call({ lines: [], recovery });
    expect(res.status).toBe(403);
    expect(h.realizeAccruals).not.toHaveBeenCalled();
  });

  it('a stale preview answers HTTP 409, not a 200 realize_failed warning', async () => {
    h.getBooking.mockResolvedValue(booking('completed'));
    h.realizeAccruals.mockRejectedValue(new FakeStale('changed'));
    const res = await call({ lines: [], recovery });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: 'recovery_preview_stale' });
  });

  it('a body without `recovery` keeps the legacy semantics even on a completed booking with lines', async () => {
    h.getBooking.mockResolvedValue(booking('completed'));
    const res = await call({ lines: [{ itemId: 'i1', qty: 1 }] });
    expect(res.status).toBe(200);
    expect(h.realizeAccruals.mock.calls[0]![1]).not.toHaveProperty('recovery');
    expect(h.hasCap).not.toHaveBeenCalled();
  });

  it('any other realize failure stays the legacy 200 stockWarning', async () => {
    h.getBooking.mockResolvedValue(booking('completed'));
    h.realizeAccruals.mockRejectedValue(new Error('boom'));
    const res = await call({ lines: [], recovery });
    expect(res.status).toBe(200);
    expect((await res.json()).stockWarning.code).toBe('realize_failed');
  });
});
