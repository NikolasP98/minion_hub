import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  user: { id: 'u1' } as unknown,
  ctx: { db: {}, tenantId: 'org-1' } as { db: object; tenantId: string } | null,
  enabled: true,
  required: vi.fn(),
  resources: [{ id: 'r1', active: true, timezone: 'America/Lima' }],
  eventTypes: [{ id: 'e1', productId: null, kindId: null }],
  window: vi.fn(
    async (
      _ctx: unknown,
      _locals: unknown,
      _opts: { from: Date; to: Date; eventTypes: unknown[] },
    ) => ({ bookings: [], invoices: [], accrualSummaries: [], tagOptions: [] }),
  ),
  createBookingResponse: vi.fn(
    async (_ctx: unknown, _locals: unknown, _request: unknown) =>
      new Response(null, { status: 201 }),
  ),
}));

vi.mock('$server/auth/authorize', () => ({
  requireAuth: (locals: { user?: unknown }) => {
    if (!locals.user && !state.user) throw new Error('unauth');
    return state.user;
  },
}));
vi.mock('$server/auth/core-ctx', () => ({ getCoreCtx: () => Promise.resolve(state.ctx) }));
vi.mock('$server/services/modules.service', () => ({
  isModuleEnabled: () => Promise.resolve(state.enabled),
}));
vi.mock('$server/services/rbac.service', () => ({
  requireOrgCapability: (...args: unknown[]) => state.required(...args),
}));
vi.mock('$server/services/scheduling.service', () => ({
  listResources: () => Promise.resolve(state.resources),
  listEventTypes: () => Promise.resolve(state.eventTypes),
}));
vi.mock('$server/services/pos-calendar-window.service', () => ({
  loadPosCalendarWindow: (
    ctx: unknown,
    locals: unknown,
    opts: { from: Date; to: Date; eventTypes: unknown[] },
  ) => state.window(ctx, locals, opts),
}));
vi.mock('../../scheduling/bookings/_handlers', () => ({
  createBookingResponse: (ctx: unknown, locals: unknown, request: unknown) =>
    state.createBookingResponse(ctx, locals, request),
}));

beforeEach(() => {
  vi.clearAllMocks();
  state.ctx = { db: {}, tenantId: 'org-1' };
  state.enabled = true;
});

const url = (qs: string) => new URL(`http://localhost/api/pos/appointments${qs}`);

describe('GET /api/pos/appointments', () => {
  it('requires pos:view and returns the window payload for a valid range', async () => {
    const { GET } = await import('./+server');
    const response = await GET({
      locals: { user: state.user },
      url: url('?from=2026-09-07&to=2026-09-13'),
    } as never);

    expect(state.required).toHaveBeenCalledWith(expect.anything(), 'pos', 'view');
    expect(state.window).toHaveBeenCalledWith(
      state.ctx,
      { user: state.user },
      expect.objectContaining({ eventTypes: state.eventTypes }),
    );
    expect(await response.json()).toEqual({
      bookings: [],
      invoices: [],
      accrualSummaries: [],
      tagOptions: [],
    });
  });

  it('resolves the window in the first active resource timezone, half-open past the last day', async () => {
    const { GET } = await import('./+server');
    await GET({
      locals: { user: state.user },
      url: url('?from=2026-09-07&to=2026-09-07'),
    } as never);

    const call = state.window.mock.calls[0]![2];
    // Lima is UTC-5 year round.
    expect(call.from.toISOString()).toBe('2026-09-07T05:00:00.000Z');
    expect(call.to.toISOString()).toBe('2026-09-08T04:59:59.999Z');
  });

  it('400s when from or to is missing', async () => {
    const { GET } = await import('./+server');
    await expect(
      GET({ locals: { user: state.user }, url: url('?from=2026-09-07') } as never),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('400s on a malformed date', async () => {
    const { GET } = await import('./+server');
    await expect(
      GET({
        locals: { user: state.user },
        url: url('?from=2026-9-7&to=2026-09-13'),
      } as never),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('400s when to is before from', async () => {
    const { GET } = await import('./+server');
    await expect(
      GET({
        locals: { user: state.user },
        url: url('?from=2026-09-13&to=2026-09-07'),
      } as never),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('400s when the range exceeds 62 days', async () => {
    const { GET } = await import('./+server');
    await expect(
      GET({
        locals: { user: state.user },
        url: url('?from=2026-01-01&to=2026-03-10'), // 69 days
      } as never),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('accepts exactly 62 days', async () => {
    const { GET } = await import('./+server');
    await expect(
      GET({
        locals: { user: state.user },
        url: url('?from=2026-01-01&to=2026-03-03'), // 62 days inclusive
      } as never),
    ).resolves.toBeInstanceOf(Response);
  });

  it('hides the endpoint (403) when scheduling or pos is disabled', async () => {
    state.enabled = false;
    const { GET } = await import('./+server');
    await expect(
      GET({ locals: { user: state.user }, url: url('?from=2026-09-07&to=2026-09-13') } as never),
    ).rejects.toMatchObject({ status: 403 });
    expect(state.required).not.toHaveBeenCalled();
  });

  it('401s before any gate without an authenticated org context', async () => {
    state.ctx = null;
    const { GET } = await import('./+server');
    await expect(
      GET({ locals: { user: state.user }, url: url('?from=2026-09-07&to=2026-09-13') } as never),
    ).rejects.toMatchObject({ status: 401 });
    expect(state.required).not.toHaveBeenCalled();
  });
});

describe('POST /api/pos/appointments', () => {
  it('delegates to the shared booking-create handler once modules are confirmed enabled', async () => {
    const { POST } = await import('./+server');
    const request = new Request('http://x', { method: 'POST' });
    const response = await POST({ locals: { user: state.user }, request } as never);

    expect(state.createBookingResponse).toHaveBeenCalledWith(
      state.ctx,
      { user: state.user },
      request,
    );
    expect(response.status).toBe(201);
  });
});
