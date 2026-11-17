/** GET /api/pos/appointments/[id] — same versioned detail under POS admission (spec 126). */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ detail: vi.fn(), required: vi.fn() }));

vi.mock('$server/auth/authorize', () => ({ requireAuth: () => ({}) }));
vi.mock('$server/auth/core-ctx', () => ({
  getCoreCtx: async () => ({ db: {}, tenantId: 'org-1' }),
}));
vi.mock('$server/services/modules.service', () => ({ isModuleEnabled: async () => true }));
vi.mock('$server/services/rbac.service', () => ({
  requireOrgCapability: (...a: unknown[]) => h.required(...a),
}));
vi.mock('../../../scheduling/bookings/_handlers', () => ({
  bookingDetailResponse: (...a: unknown[]) => h.detail(...a),
  patchBookingResponse: vi.fn(),
}));

const { GET } = await import('./+server');

beforeEach(() => {
  vi.clearAllMocks();
  h.detail.mockResolvedValue(new Response('{}'));
});

describe('GET /api/pos/appointments/[id]', () => {
  it('requires pos:view and hands the REQUEST to the versioned detail handler', async () => {
    const request = new Request('http://x', {
      headers: { 'X-Minion-Booking-Products-Version': '1' },
    });
    await GET({ locals: { user: {} }, params: { id: 'b1' }, request } as never);
    expect(h.required).toHaveBeenCalledWith(expect.anything(), 'pos', 'view');
    expect(h.detail).toHaveBeenCalledWith(
      { db: {}, tenantId: 'org-1' },
      { user: {} },
      'b1',
      request,
    );
  });

  it('denies before the handler when pos:view is refused', async () => {
    h.required.mockRejectedValue(Object.assign(new Error('no'), { status: 403 }));
    await expect(
      GET({
        locals: { user: {} },
        params: { id: 'b1' },
        request: new Request('http://x'),
      } as never),
    ).rejects.toMatchObject({ status: 403 });
    expect(h.detail).not.toHaveBeenCalled();
  });
});
