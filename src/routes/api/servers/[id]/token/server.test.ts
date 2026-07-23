import { beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getGatewayTokenByServerId: vi.fn(),
  getServerToken: vi.fn(),
  gatewayBelongsToOrg: vi.fn(),
  resolveGatewayId: vi.fn(),
}));

vi.mock('$server/auth/authorize', () => ({
  requireAuth: () => ({ id: 'user-1', role: 'admin', supabaseId: 'profile-1' }),
}));

vi.mock('$server/auth/tenant-ctx', () => ({
  getTenantCtx: () => Promise.resolve({ db: {}, tenantId: 'org-1' }),
}));

vi.mock('$server/services/server.service', () => ({
  getServerToken: mocks.getServerToken,
}));

vi.mock('$server/services/gateway.pg.service', () => ({
  userHasGatewayAccess: vi.fn(),
  getGatewayTokenByServerId: mocks.getGatewayTokenByServerId,
  gatewayBelongsToOrg: mocks.gatewayBelongsToOrg,
  resolveGatewayId: mocks.resolveGatewayId,
}));

import { POST } from './+server';

function event() {
  return {
    locals: { user: { email: 'admin@example.com', role: 'admin' } },
    params: { id: 'server-1' },
  } as never;
}

describe('POST /api/servers/[id]/token', () => {
  beforeEach(() => {
    mocks.getGatewayTokenByServerId.mockReset();
    mocks.getServerToken.mockReset();
    mocks.gatewayBelongsToOrg.mockReset().mockResolvedValue(true);
    mocks.resolveGatewayId.mockReset().mockResolvedValue('gateway-1');
  });

  test('returns 503 instead of a false 404 when PG is unavailable', async () => {
    mocks.getGatewayTokenByServerId.mockRejectedValue(
      new Error('EMAXCONN max client connections reached'),
    );
    mocks.getServerToken.mockResolvedValue(null);

    const response = await POST(event());

    expect(response.status).toBe(503);
    expect(response.headers.get('retry-after')).toBe('2');
    await expect(response.json()).resolves.toEqual({
      error: 'Gateway registry temporarily unavailable',
    });
  });

  test('keeps a genuine registry miss as 404', async () => {
    mocks.getGatewayTokenByServerId.mockResolvedValue(null);
    mocks.getServerToken.mockResolvedValue(null);

    const response = await POST(event());

    expect(response.status).toBe(404);
  });

  test('returns the PG gateway token without consulting Turso', async () => {
    mocks.getGatewayTokenByServerId.mockResolvedValue('gateway-secret');

    const response = await POST(event());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ token: 'gateway-secret' });
    expect(mocks.getGatewayTokenByServerId).toHaveBeenCalledWith('server-1', 'org-1');
    expect(mocks.getServerToken).not.toHaveBeenCalled();
  });

  test('falls back to an org-scoped Turso token when no PG gateway bridges the legacy id', async () => {
    mocks.resolveGatewayId.mockResolvedValue(null);
    mocks.getServerToken.mockResolvedValue('legacy-secret');

    const response = await POST(event());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ token: 'legacy-secret' });
    expect(mocks.gatewayBelongsToOrg).not.toHaveBeenCalled();
    expect(mocks.getGatewayTokenByServerId).not.toHaveBeenCalled();
  });

  // Spec §C5: an org may not reach a gateway (and therefore a channel) it has no
  // row for, even by hand-crafting the request. Admin is NOT an exemption — the
  // old handler let any admin fetch any gateway's token, which is precisely how
  // FACES could have reached DEV.
  test('404s a gateway that is not assigned to the active org, admin included', async () => {
    mocks.gatewayBelongsToOrg.mockResolvedValue(false);
    mocks.getGatewayTokenByServerId.mockResolvedValue('gateway-secret');

    const response = await POST(event());

    expect(response.status).toBe(404);
    expect(mocks.getGatewayTokenByServerId).not.toHaveBeenCalled();
  });
});
