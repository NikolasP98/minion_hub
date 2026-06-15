import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGetTenantCtx = vi.fn<(locals: unknown) => Promise<unknown>>();
vi.mock('$server/auth/tenant-ctx', () => ({
  getTenantCtx: (locals: unknown) => mockGetTenantCtx(locals),
}));

const mockGetGoogleCredential =
  vi.fn<(ctx: unknown, userId: string) => Promise<unknown>>();
vi.mock('$server/services/identity.service', () => ({
  getGoogleCredential: (ctx: unknown, userId: string) => mockGetGoogleCredential(ctx, userId),
}));

import { GET } from './+server';

function makeEvent(userId: string | null, locals: Record<string, unknown> = { serverId: 'srv1' }) {
  const u = new URL('http://localhost/api/gateway/google-adc');
  if (userId !== null) u.searchParams.set('userId', userId);
  return { locals, url: u } as never;
}

beforeEach(() => vi.clearAllMocks());

describe('GET /api/gateway/google-adc', () => {
  it('401 when no tenant context (bad/no token)', async () => {
    mockGetTenantCtx.mockResolvedValue(null);
    await expect(GET(makeEvent('u1'))).rejects.toMatchObject({ status: 401 });
  });

  it('400 when userId missing', async () => {
    mockGetTenantCtx.mockResolvedValue({ db: {}, tenantId: 't1' });
    await expect(GET(makeEvent(null))).rejects.toMatchObject({ status: 400 });
  });

  it('returns the decrypted ADC for a linked user', async () => {
    mockGetTenantCtx.mockResolvedValue({ db: {}, tenantId: 't1' });
    mockGetGoogleCredential.mockResolvedValue({
      email: 'nik@example.com',
      adc: { client_id: 'c', client_secret: 's', refresh_token: 'r', type: 'authorized_user' },
    });
    const res = await GET(makeEvent('u1'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      email: 'nik@example.com',
      adc: { client_id: 'c', client_secret: 's', refresh_token: 'r', type: 'authorized_user' },
    });
    expect(mockGetGoogleCredential).toHaveBeenCalledWith({ db: {}, tenantId: 't1' }, 'u1');
  });

  it('404 when the user has no google identity', async () => {
    mockGetTenantCtx.mockResolvedValue({ db: {}, tenantId: 't1' });
    mockGetGoogleCredential.mockResolvedValue(null);
    const res = await GET(makeEvent('stranger'));
    expect(res.status).toBe(404);
  });

  it('403 when a non-admin session requests another user (no IDOR)', async () => {
    mockGetTenantCtx.mockResolvedValue({ db: {}, tenantId: 't1' });
    await expect(
      GET(makeEvent('victim', { user: { id: 'attacker', role: 'user' } })),
    ).rejects.toMatchObject({ status: 403 });
    expect(mockGetGoogleCredential).not.toHaveBeenCalled();
  });

  it('allows a user to fetch their OWN credential', async () => {
    mockGetTenantCtx.mockResolvedValue({ db: {}, tenantId: 't1' });
    mockGetGoogleCredential.mockResolvedValue({
      email: 'me@example.com',
      adc: { client_id: 'c', client_secret: 's', refresh_token: 'r', type: 'authorized_user' },
    });
    const res = await GET(makeEvent('me', { user: { id: 'me', role: 'user' } }));
    expect(res.status).toBe(200);
  });
});
