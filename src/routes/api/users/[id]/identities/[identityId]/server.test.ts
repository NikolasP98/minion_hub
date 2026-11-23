import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockRemove = vi.fn<(ctx: unknown, userId: string, identityId: string) => Promise<boolean>>();
vi.mock('$server/services/identity.service', () => ({
  removeIdentity: (ctx: unknown, userId: string, identityId: string) =>
    mockRemove(ctx, userId, identityId),
}));

const mockOAuthDelete = vi.fn<(userId: string, identityId: string) => Promise<boolean>>();
vi.mock('$server/services/supabase-credential', () => ({
  deleteOAuthIdentityFromSupabase: (u: string, i: string) => mockOAuthDelete(u, i),
}));

import { DELETE } from './+server';

function makeEvent(opts: { userId: string; role?: string; paramId: string; source?: string }) {
  const url = new URL('http://x/api' + (opts.source ? `?source=${opts.source}` : ''));
  return {
    locals: {
      tenantCtx: { db: {}, tenantId: 't1' },
      user: { id: opts.userId, role: opts.role ?? 'member' },
    },
    params: { id: opts.paramId, identityId: 'iB' },
    url,
  } as never;
}

beforeEach(() => vi.clearAllMocks());

describe('DELETE /api/users/[id]/identities/[identityId]', () => {
  it('owner deletes own identity, scoped to the URL user', async () => {
    mockRemove.mockResolvedValue(true);
    const res = await DELETE(makeEvent({ userId: 'A', paramId: 'A' }));
    expect(res.status).toBe(200);
    expect(mockRemove).toHaveBeenCalledWith(expect.anything(), 'A', 'iB');
  });

  it('own id in URL + another user identity id -> 404', async () => {
    mockRemove.mockResolvedValue(false); // owner-filtered delete matches nothing
    await expect(DELETE(makeEvent({ userId: 'A', paramId: 'A' }))).rejects.toMatchObject({
      status: 404,
    });
    expect(mockRemove).toHaveBeenCalledWith(expect.anything(), 'A', 'iB');
  });

  it('non-owner non-admin -> 403 and nothing deleted', async () => {
    await expect(DELETE(makeEvent({ userId: 'A', paramId: 'X' }))).rejects.toMatchObject({
      status: 403,
    });
    expect(mockRemove).not.toHaveBeenCalled();
  });

  it('admin deletes the named user identity; other-user identity under that URL -> 404', async () => {
    mockRemove.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    const ok = await DELETE(makeEvent({ userId: 'adm', role: 'admin', paramId: 'X' }));
    expect(ok.status).toBe(200);
    expect(mockRemove).toHaveBeenLastCalledWith(expect.anything(), 'X', 'iB');
    await expect(
      DELETE(makeEvent({ userId: 'adm', role: 'admin', paramId: 'X' })),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('source=supabase path still owner-scoped by URL user', async () => {
    mockOAuthDelete.mockResolvedValue(false);
    await expect(
      DELETE(makeEvent({ userId: 'A', paramId: 'A', source: 'supabase' })),
    ).rejects.toMatchObject({ status: 404 });
    expect(mockOAuthDelete).toHaveBeenCalledWith('A', 'iB');
    expect(mockRemove).not.toHaveBeenCalled();
  });
});
