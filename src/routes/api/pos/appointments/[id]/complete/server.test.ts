/**
 * The POS-path complete endpoint runs the SAME handler as the scheduling one (spec 126):
 * same body, same recovery guard, same module check.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ complete: vi.fn(), enabled: vi.fn(), ctx: vi.fn() }));

vi.mock('$server/auth/authorize', () => ({ requireAuth: () => ({ id: 'u1' }) }));
vi.mock('$server/auth/core-ctx', () => ({ getCoreCtx: (...a: unknown[]) => h.ctx(...a) }));
vi.mock('$server/services/modules.service', () => ({
  isModuleEnabled: (...a: unknown[]) => h.enabled(...a),
}));
vi.mock('../../../../scheduling/bookings/_handlers', () => ({
  completeBookingResponse: (...a: unknown[]) => h.complete(...a),
}));

const { POST } = await import('./+server');
const event = () =>
  ({
    locals: { user: { id: 'u1' } },
    params: { id: 'b1' },
    request: new Request('http://x', { method: 'POST', body: '{}' }),
  }) as never;

beforeEach(() => {
  vi.clearAllMocks();
  h.ctx.mockResolvedValue({ db: {}, tenantId: 'org-1' });
  h.enabled.mockResolvedValue(true);
  h.complete.mockResolvedValue(new Response('{}', { status: 200 }));
});

describe('POST /api/pos/appointments/[id]/complete', () => {
  it('delegates to the shared complete handler with the booking id', async () => {
    const res = await POST(event());
    expect(res.status).toBe(200);
    expect(h.complete).toHaveBeenCalledWith(
      { db: {}, tenantId: 'org-1' },
      { user: { id: 'u1' } },
      expect.any(Request),
      'b1',
    );
  });

  it('keeps the scheduling module check and the 401 without a tenant', async () => {
    h.enabled.mockResolvedValue(false);
    await expect(POST(event())).rejects.toMatchObject({ status: 403 });
    h.enabled.mockResolvedValue(true);
    h.ctx.mockResolvedValue(null);
    await expect(POST(event())).rejects.toMatchObject({ status: 401 });
    expect(h.complete).not.toHaveBeenCalled();
  });
});
