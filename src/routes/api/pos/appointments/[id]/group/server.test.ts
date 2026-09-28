import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  user: { id: 'u1' } as unknown,
  ctx: { db: {}, tenantId: 'org-1' } as { db: object; tenantId: string } | null,
  enabled: true,
  required: vi.fn(),
  groupBookingResponse: vi.fn(
    async (_ctx: unknown, _request: unknown, _id: unknown) =>
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
  ),
}));

vi.mock('$server/auth/authorize', () => ({
  requireAuth: (locals: { user?: unknown }) => {
    if (!locals.user) throw { status: 401 };
    return locals.user;
  },
}));
vi.mock('$server/auth/core-ctx', () => ({ getCoreCtx: () => Promise.resolve(state.ctx) }));
vi.mock('$server/services/modules.service', () => ({
  isModuleEnabled: () => Promise.resolve(state.enabled),
}));
vi.mock('$server/services/rbac.service', () => ({
  requireOrgCapability: (...args: unknown[]) => state.required(...args),
}));
vi.mock('../../../../scheduling/bookings/_handlers', () => ({
  groupBookingResponse: (ctx: unknown, request: unknown, id: unknown) =>
    state.groupBookingResponse(ctx, request, id),
}));

beforeEach(() => {
  vi.clearAllMocks();
  state.ctx = { db: {}, tenantId: 'org-1' };
  state.enabled = true;
  state.required.mockResolvedValue({ can: () => true });
});

const request = () => new Request('http://x', { method: 'POST' });

describe('POST /api/pos/appointments/[id]/group', () => {
  it('requires pos:edit, then delegates to the shared groupBookingResponse', async () => {
    const { POST } = await import('./+server');
    const req = request();

    const response = await POST({
      locals: { user: state.user },
      request: req,
      params: { id: 'b1' },
    } as never);

    expect(state.required).toHaveBeenCalledWith({ user: state.user }, 'pos', 'edit');
    expect(state.groupBookingResponse).toHaveBeenCalledWith(state.ctx, req, 'b1');
    expect(response.status).toBe(200);
  });

  it('rejects before calling the handler when the capability is missing', async () => {
    state.required.mockRejectedValueOnce({ status: 403 });
    const { POST } = await import('./+server');

    await expect(
      POST({ locals: { user: state.user }, request: request(), params: { id: 'b1' } } as never),
    ).rejects.toMatchObject({ status: 403 });
    expect(state.groupBookingResponse).not.toHaveBeenCalled();
  });

  it('hides the endpoint (403) when scheduling or pos is disabled, before checking the capability', async () => {
    state.enabled = false;
    const { POST } = await import('./+server');

    await expect(
      POST({ locals: { user: state.user }, request: request(), params: { id: 'b1' } } as never),
    ).rejects.toMatchObject({ status: 403 });
    expect(state.required).not.toHaveBeenCalled();
    expect(state.groupBookingResponse).not.toHaveBeenCalled();
  });

  it('401s before any gate without an authenticated org context', async () => {
    state.ctx = null;
    const { POST } = await import('./+server');

    await expect(
      POST({ locals: { user: state.user }, request: request(), params: { id: 'b1' } } as never),
    ).rejects.toMatchObject({ status: 401 });
    expect(state.required).not.toHaveBeenCalled();
  });
});
