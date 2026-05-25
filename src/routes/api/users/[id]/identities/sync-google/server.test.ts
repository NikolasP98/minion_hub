import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockSync = vi.fn<(ctx: unknown, userId: string) => Promise<unknown>>();
vi.mock('$server/services/identity.service', () => ({
  syncGoogleIdentityFromAccount: (ctx: unknown, userId: string) => mockSync(ctx, userId),
}));

const mockRequireAdmin = vi.fn();
vi.mock('$server/auth/authorize', () => ({
  requireAdmin: (locals: unknown) => mockRequireAdmin(locals),
}));

import { POST } from './+server';

function makeEvent(opts: { userId: string; paramId: string; tenantCtx?: unknown }) {
  const tenantCtx = 'tenantCtx' in opts ? opts.tenantCtx : { db: {}, tenantId: 't1' };
  return {
    locals: { tenantCtx, user: { id: opts.userId } },
    params: { id: opts.paramId },
  } as never;
}

beforeEach(() => vi.clearAllMocks());

describe('POST /api/users/[id]/identities/sync-google', () => {
  it('401 without tenant context', async () => {
    await expect(
      POST(makeEvent({ userId: 'u1', paramId: 'u1', tenantCtx: null })),
    ).rejects.toMatchObject({ status: 401 });
  });

  it('owner can sync own google account', async () => {
    mockSync.mockResolvedValue({ email: 'nik@example.com' });
    const res = await POST(makeEvent({ userId: 'u1', paramId: 'u1' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, email: 'nik@example.com' });
    expect(mockRequireAdmin).not.toHaveBeenCalled(); // owner bypasses admin check
  });

  it('non-owner requires admin', async () => {
    mockSync.mockResolvedValue({ email: 'x@y.com' });
    await POST(makeEvent({ userId: 'u1', paramId: 'other' }));
    expect(mockRequireAdmin).toHaveBeenCalled();
  });

  it('404 when no google account linked', async () => {
    mockSync.mockResolvedValue(null);
    const res = await POST(makeEvent({ userId: 'u1', paramId: 'u1' }));
    expect(res.status).toBe(404);
  });
});
