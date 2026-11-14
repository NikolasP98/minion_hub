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
}));
vi.mock('$server/services/stock-accruals.service', () => ({
  realizeAccruals: (...a: unknown[]) => h.realizeAccruals(...a),
}));

const { POST } = await import('./+server');

const call = () =>
  POST({
    locals: { user: { id: 'u1' } },
    params: { id: 'b1' },
    request: new Request('http://x', { method: 'POST', body: '{}' }),
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
