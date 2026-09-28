import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  user: { id: 'u1' } as unknown,
  ctx: { db: {}, tenantId: 'org-1' } as { db: object; tenantId: string } | null,
  enabled: true,
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
vi.mock('../../_handlers', () => ({
  groupBookingResponse: (ctx: unknown, request: unknown, id: unknown) =>
    state.groupBookingResponse(ctx, request, id),
}));

beforeEach(() => {
  vi.clearAllMocks();
  state.ctx = { db: {}, tenantId: 'org-1' };
  state.enabled = true;
});

const request = () => new Request('http://x', { method: 'POST' });

describe('POST /api/scheduling/bookings/[id]/group', () => {
  it('delegates to the shared groupBookingResponse once scheduling is confirmed enabled', async () => {
    const { POST } = await import('./+server');
    const req = request();

    const response = await POST({
      locals: { user: state.user },
      request: req,
      params: { id: 'b1' },
    } as never);

    expect(state.groupBookingResponse).toHaveBeenCalledWith(state.ctx, req, 'b1');
    expect(response.status).toBe(200);
  });

  it('hides the endpoint (403) when scheduling is disabled, before calling the handler', async () => {
    state.enabled = false;
    const { POST } = await import('./+server');

    await expect(
      POST({ locals: { user: state.user }, request: request(), params: { id: 'b1' } } as never),
    ).rejects.toMatchObject({ status: 403 });
    expect(state.groupBookingResponse).not.toHaveBeenCalled();
  });

  it('401s before any gate without an authenticated org context', async () => {
    state.ctx = null;
    const { POST } = await import('./+server');

    await expect(
      POST({ locals: { user: state.user }, request: request(), params: { id: 'b1' } } as never),
    ).rejects.toMatchObject({ status: 401 });
    expect(state.groupBookingResponse).not.toHaveBeenCalled();
  });

  it('401s (via requireAuth) with no authenticated user at all', async () => {
    const { POST } = await import('./+server');

    await expect(
      POST({ locals: {}, request: request(), params: { id: 'b1' } } as never),
    ).rejects.toMatchObject({ status: 401 });
    expect(state.groupBookingResponse).not.toHaveBeenCalled();
  });
});
