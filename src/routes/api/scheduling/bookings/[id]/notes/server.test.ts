import { beforeEach, describe, expect, it, vi } from 'vitest';
import { StaleWriteError } from '$server/services/errors';

const state = vi.hoisted(() => ({
  updateBookingNotes: vi.fn(
    async (_ctx: unknown, _id: string, _patch: unknown, _expected?: Date) =>
      ({ id: 'b1', notes: 'mine', updatedAt: new Date('2026-06-02T00:00:00Z') }) as unknown,
  ),
}));
vi.mock('$server/auth/authorize', () => ({ requireAuth: () => ({ id: 'u1' }) }));
vi.mock('$server/auth/core-ctx', () => ({
  getCoreCtx: () => Promise.resolve({ db: {}, tenantId: 'org-1' }),
}));
vi.mock('$server/services/modules.service', () => ({
  isModuleEnabled: () => Promise.resolve(true),
}));
vi.mock('$server/services/scheduling-bookings.service', () => ({
  updateBookingNotes: (ctx: unknown, id: string, patch: unknown, expected?: Date) =>
    state.updateBookingNotes(ctx, id, patch, expected),
}));

const { PUT } = await import('./+server');
const put = (body: unknown) =>
  PUT({
    locals: { user: { id: 'u1' } },
    params: { id: 'b1' },
    request: new Request('http://x', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  } as never);

beforeEach(() => vi.clearAllMocks());

describe('PUT /api/scheduling/bookings/[id]/notes — stale-write guard', () => {
  it('threads a fresh expectedUpdatedAt and answers the booking with its new token', async () => {
    const res = await put({ notes: 'mine', expectedUpdatedAt: '2026-06-01T00:00:00.000Z' });
    expect(res.status).toBe(200);
    expect(state.updateBookingNotes).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'org-1' }),
      'b1',
      { notes: 'mine' },
      new Date('2026-06-01T00:00:00.000Z'),
    );
    expect((await res.json()).booking.updatedAt).toBe('2026-06-02T00:00:00.000Z');
  });

  it('stays backward compatible when the token is omitted', async () => {
    const res = await put({ notes: 'mine' });
    expect(res.status).toBe(200);
    expect(state.updateBookingNotes.mock.calls[0][3]).toBeUndefined();
  });

  it('answers 409 { error: stale, current } for a stale token', async () => {
    const current = { id: 'b1', notes: 'theirs', updatedAt: '2026-06-03T00:00:00.000Z' };
    state.updateBookingNotes.mockRejectedValueOnce(new StaleWriteError(current));
    const res = await put({ notes: 'mine', expectedUpdatedAt: '2020-01-01T00:00:00Z' });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'stale', current });
  });
});
